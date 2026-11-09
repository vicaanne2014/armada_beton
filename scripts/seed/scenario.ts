import type { Refs, Row, SeedApi } from "./types";

/** PNG 1x1 piksel sebagai contoh "foto surat jalan". */
const PNG_1X1 = Uint8Array.from(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"),
);

export interface ScenarioResult {
  skipped: boolean;
  documents: number;
  warnings: Array<{ doc: string; code: string }>;
}

type Stage = "draft" | "submitted" | "approved" | "validated";

/**
 * Skenario transaksi demo satu bulan operasi batching plant precast. Semuanya lewat RPC sebagai user yang berwenang
 * (pembuat → Kepala Departemen → Kepala Gudang), sehingga ledger, saldo, penomoran, dan audit terbentuk secara sah.
 *
 * Hasil akhir (untuk pengujian manual), dokumen per status:
 *   Tervalidasi 17 · Menunggu Validasi 4 · Menunggu Approval 4 · Dikembalikan 2 · Ditolak 2 · Draft 3
 * Kisah yang bisa ditelusuri:
 *   PO-PRD-2611-001  U-Ditch 60: 2 permintaan material (2 gudang), penerimaan bertahap 80+70 (+50 menunggu), 1 pengiriman
 *   PO-PRD-2611-002  Buis 80: target 150 tercapai, 3 pengiriman (1 dibalik), kelebihan 10 memicu peringatan
 *   Opname selesai di Bin Pasir 1 (selisih -2 m³); opname berjalan mengunci Blok 1C
 */
export async function runScenario(api: SeedApi, ref: Refs, log: (m: string) => void): Promise<ScenarioResult> {
  const existing = await api.select(null, "document");
  if (existing.length > 0) {
    log(`Skenario demo dilewati: sudah ada ${existing.length} dokumen (ledger tidak bisa direset dari aplikasi).`);
    return { skipped: true, documents: existing.length, warnings: [] };
  }

  const today = new Date().toISOString().slice(0, 10);
  const warnings: ScenarioResult["warnings"] = [];
  const { wh, item: it, loc: lc, party: pt } = ref;

  // ---------- helper ----------
  const line = (i: string, qty: number, l?: string, to?: string): Row => ({
    item_id: it[i],
    qty: String(qty),
    location_id: l ? lc[l] : "",
    to_location_id: to ? lc[to] : "",
  });
  const draft = async (as: string, type: string, header: Row, lines: Row[]) =>
    (await api.rpc(as, "save_draft", { p_doc_type: type, p_doc_id: null, p_payload: { header, lines } })) as string;
  const submit = async (as: string, id: string, label: string) => {
    const r = (await api.rpc(as, "submit_document", { p_doc_id: id })) as { status: string; warnings: Array<{ code: string }> };
    for (const w of r.warnings ?? []) warnings.push({ doc: label, code: w.code });
    return r;
  };
  const decide = (as: string, id: string, decision: string, reason?: string, alloc?: Row[]) =>
    api.rpc(as, "decide_document", { p_doc_id: id, p_decision: decision, p_reason: reason ?? null, p_allocations: alloc ?? null });

  /** Majukan dokumen sampai tahap tertentu. approver = null bila alur tanpa langkah Kepala Departemen. */
  async function advance(
    label: string,
    id: string,
    p: { creator: string; approver: string | null; validator: string; to: Stage; alloc?: Row[] },
  ) {
    if (p.to === "draft") return;
    const sub = await submit(p.creator, id, label);
    if (p.to === "submitted") return;
    if (p.approver && sub.status === "MENUNGGU_APPROVAL") await decide(p.approver, id, "APPROVE");
    if (p.to === "approved") return;
    await decide(p.validator, id, "APPROVE", undefined, p.alloc);
  }

  const alloc = async (as: string, docId: string, picks: Record<string, Array<[string, number]>>): Promise<Row[]> => {
    const lines = await api.select(as, "document_line", { document_id: docId });
    const lineOf = new Map(lines.map((l) => [l.item_id as string, l.id as string]));
    return Object.entries(picks).flatMap(([code, parts]) =>
      parts.map(([where, qty]) => ({ line_id: lineOf.get(it[code])!, location_id: lc[where], qty: String(qty) })),
    );
  };
  const poId = async (po: string) => (await api.select(null, "production_po", { po_number: po }))[0].id as string;

  const receipt = (as: string, whCode: string, sj: string, sup: string, po: string, lines: Array<[string, number, string]>) =>
    draft(
      as,
      "MATERIAL_RECEIPT",
      { warehouse_id: wh[whCode], sj_number: sj, receipt_date: today, sender_party_id: pt[sup], po_number: po, po_date: today },
      lines.map(([i, q, l]) => line(i, q, l)),
    );
  const request = (as: string, whCode: string, po: string, fg: string, target: number, lines: Array<[string, number]>) =>
    draft(
      as,
      "MATERIAL_REQUEST",
      { warehouse_id: wh[whCode], po_number: po, finished_item_id: it[fg], target_qty: String(target) },
      lines.map(([i, q]) => line(i, q)),
    );
  const fgReceipt = async (po: string, i: string, qty: number, where: string) =>
    draft("staff_bj", "FG_RECEIPT", { warehouse_id: wh["WH-F"], production_po_id: await poId(po) }, [line(i, qty, where)]);
  const delivery = (cust: string, i: string, qty: number, where: string, ref?: string) =>
    draft(
      "staff_bj",
      "DELIVERY_NOTE",
      { warehouse_id: wh["WH-F"], customer_id: pt[cust], delivery_date: today, customer_po_ref: ref ?? "" },
      [line(i, qty, where)],
    );
  const attach = async (as: string, docId: string, name: string) => {
    if (api.uploadAttachment) await api.uploadAttachment(as, docId, name, PNG_1X1, "image/png");
  };

  // alur approval gudang: Kepala Dept. Gudang → Kepala Gudang terkait
  const GM = { approver: "kadep_gudang", validator: "kagud_material" } as const;
  const GA = { approver: "kadep_gudang", validator: "kagud_agregat" } as const;
  const GF = { approver: "kadep_gudang", validator: "kagud_bj" } as const;
  const PM = { approver: "kadep_prod", validator: "kagud_material" } as const;

  // =====================================================================
  // 1. PENERIMAAN MATERIAL (surat jalan masuk + referensi PO pembelian)
  // =====================================================================
  log("1/7 penerimaan material");
  const r1 = await receipt("staff_material", "WH-M", "SJ-SMN-2611-001", "SUP-01", "PO-BELI-2611-001", [
    ["SEMEN-PC", 400, "M-A1"], ["ADT-SP", 300, "M-C1"], ["BESI-8", 3000, "M-B1"],
  ]);
  await advance("R1", r1, { creator: "staff_material", ...GM, to: "validated" });

  // divalidasi oleh DEPUTI (wakil) untuk menguji penugasan pengganti
  const r2 = await receipt("staff_material", "WH-M", "SJ-SMN-2611-002", "SUP-01", "PO-BELI-2611-001", [["SEMEN-PC", 200, "M-A2"]]);
  await submit("staff_material", r2, "R2");
  await decide("wakil_kadep_gudang", r2, "APPROVE");
  await decide("wakil_kagud_material", r2, "APPROVE");

  const r3 = await receipt("staff_material", "WH-M", "SJ-BSI-2611-001", "SUP-04", "PO-BELI-2611-002", [
    ["BESI-D13", 5000, "M-B2"], ["KAWAT-BDR", 300, "M-B1"], ["SPACER", 2000, "M-A3"],
  ]);
  await advance("R3", r3, { creator: "staff_material", ...GM, to: "validated" });

  const r4 = await receipt("staff_material", "WH-M", "SJ-KMA-2611-001", "SUP-03", "PO-BELI-2611-003", [
    ["ADT-RT", 200, "M-C1"], ["MINYAK-BKS", 200, "M-C1"],
  ]);
  await advance("R4", r4, { creator: "staff_material", ...GM, to: "approved" }); // menunggu validasi Kepala Gudang

  const r5 = await receipt("staff_agregat", "WH-M2", "SJ-AGR-2611-001", "SUP-02", "PO-BELI-2611-004", [
    ["PASIR", 80, "AG-P1"], ["PASIR", 40, "AG-P2"], ["BATU-12", 150, "AG-B1"], ["BATU-05", 60, "AG-B2"],
  ]);
  await advance("R5", r5, { creator: "staff_agregat", ...GA, to: "validated" });
  const r6 = await receipt("staff_agregat", "WH-M2", "SJ-FAS-2611-001", "SUP-02", "PO-BELI-2611-005", [["FLYASH", 30000, "AG-FA"]]);
  await advance("R6", r6, { creator: "staff_agregat", ...GA, to: "validated" });

  const r7 = await receipt("staff_material", "WH-M", "SJ-SMN-2611-003", "SUP-01", "PO-BELI-2611-006", [["SEMEN-PC", 150, "M-A1"]]);
  await submit("staff_material", r7, "R7");
  await decide("kadep_gudang", r7, "RETURN", "Foto surat jalan belum terlampir dan qty berbeda dengan PO. Mohon lengkapi.");
  await attach("staff_material", r7, "surat-jalan-smn-003.png");

  const r8 = await receipt("staff_material", "WH-M", "SJ-SMN-2611-099", "SUP-01", "PO-BELI-2611-001", [["SEMEN-PC", 50, "M-A1"]]);
  await submit("staff_material", r8, "R8");
  await decide("kadep_gudang", r8, "REJECT", "Nomor surat jalan tidak sesuai dengan PO. Barang belum diterima.");

  const r9 = await receipt("staff_material", "WH-M", "SJ-SMN-2611-004", "SUP-01", "PO-BELI-2611-007", [["SEMEN-PC", 100, "M-A2"]]);
  await attach("staff_material", r9, "surat-jalan-smn-004.png"); // draft dengan lampiran

  // =====================================================================
  // 2. PERMINTAAN MATERIAL KE PRODUKSI (PO produksi diinput manual)
  // =====================================================================
  log("2/7 permintaan material & PO produksi");
  const q1 = await request("staff_prod", "WH-M", "PO-PRD-2611-001", "UDITCH-60", 200, [
    ["SEMEN-PC", 120], ["BESI-8", 600], ["KAWAT-BDR", 40], ["ADT-SP", 60],
  ]);
  await submit("staff_prod", q1, "Q1");
  await decide("kadep_prod", q1, "APPROVE");
  await decide("kagud_material", q1, "APPROVE", undefined, await alloc("kagud_material", q1, {
    "SEMEN-PC": [["M-A1", 80], ["M-A2", 40]], // satu material diambil dari dua penempatan
    "BESI-8": [["M-B1", 600]], "KAWAT-BDR": [["M-B1", 40]], "ADT-SP": [["M-C1", 60]],
  }));

  // permintaan kedua untuk PO yang SAMA, gudang lain (agregat): PO dipakai ulang
  const q2 = await request("staff_prod", "WH-M2", "PO-PRD-2611-001", "UDITCH-60", 200, [["PASIR", 18], ["BATU-12", 25]]);
  await submit("staff_prod", q2, "Q2");
  await decide("kadep_prod", q2, "APPROVE");
  await decide("kagud_agregat", q2, "APPROVE", undefined, await alloc("kagud_agregat", q2, {
    PASIR: [["AG-P1", 18]], "BATU-12": [["AG-B1", 25]],
  }));

  const q3 = await request("staff_prod", "WH-M", "PO-PRD-2611-002", "BUIS-80", 150, [["SEMEN-PC", 90], ["BESI-D13", 1200], ["SPACER", 400]]);
  await submit("staff_prod", q3, "Q3");
  await decide("kadep_prod", q3, "APPROVE");
  await decide("kagud_material", q3, "APPROVE", undefined, await alloc("kagud_material", q3, {
    "SEMEN-PC": [["M-A1", 90]], "BESI-D13": [["M-B2", 1200]], SPACER: [["M-A3", 400]],
  }));

  const q4 = await request("staff_prod", "WH-M", "PO-PRD-2611-003", "PAVING-6", 500, [["SEMEN-PC", 60], ["BESI-8", 200]]);
  await advance("Q4", q4, { creator: "staff_prod", ...PM, to: "approved" }); // menunggu validasi
  const q5 = await request("staff_prod2", "WH-M", "PO-PRD-2611-004", "KANSTEEN-30", 400, [["SEMEN-PC", 30]]);
  await advance("Q5", q5, { creator: "staff_prod2", ...PM, to: "submitted" }); // menunggu approval Kepala Produksi

  const q6 = await request("staff_prod", "WH-M", "PO-PRD-2611-005", "BUIS-60", 100, [["SEMEN-PC", 40]]);
  await submit("staff_prod", q6, "Q6");
  await decide("kadep_prod", q6, "REJECT", "Jadwal produksi dibatalkan PPIC. Ajukan ulang bila jadwal berubah.");

  const q7 = await request("staff_prod2", "WH-M", "PO-PRD-2611-006", "UDITCH-40", 50, [["ADT-SP", 500]]);
  await submit("staff_prod2", q7, "Q7");
  await decide("kadep_prod", q7, "APPROVE");
  await decide("kagud_material", q7, "RETURN", "Qty aditif melebihi dosis standar untuk target 50 pcs. Mohon revisi.");

  // stok semen total 390 sak < 5000 diminta: submit memberi PERINGATAN (tidak memblokir)
  const q8 = await request("staff_prod2", "WH-M", "PO-PRD-2611-007", "PAVING-8", 80, [["SEMEN-PC", 5000]]);
  await advance("Q8", q8, { creator: "staff_prod2", ...PM, to: "submitted" });

  // =====================================================================
  // 3. PEMINDAHAN ANTAR PENEMPATAN (default tanpa approval Kepala Dept.)
  // =====================================================================
  log("3/7 pemindahan penempatan");
  const t1 = await draft("staff_material", "STOCK_TRANSFER", { warehouse_id: wh["WH-M"] }, [line("SEMEN-PC", 100, "M-A1", "M-A2")]);
  await advance("T1", t1, { creator: "staff_material", approver: null, validator: "kagud_material", to: "validated" });

  // =====================================================================
  // 4. PENERIMAAN BARANG JADI (wajib memilih PO produksi yang sudah ada)
  // =====================================================================
  log("4/7 penerimaan barang jadi");
  const f1 = await fgReceipt("PO-PRD-2611-001", "UDITCH-60", 80, "F-1A");
  await advance("F1", f1, { creator: "staff_bj", ...GF, to: "validated" });
  const f2 = await fgReceipt("PO-PRD-2611-001", "UDITCH-60", 70, "F-1B"); // penerimaan bertahap
  await advance("F2", f2, { creator: "staff_bj", ...GF, to: "validated" });
  const f3 = await fgReceipt("PO-PRD-2611-001", "UDITCH-60", 50, "F-1A");
  await advance("F3", f3, { creator: "staff_bj", ...GF, to: "submitted" });
  const f4 = await fgReceipt("PO-PRD-2611-002", "BUIS-80", 150, "F-1C");
  await advance("F4", f4, { creator: "staff_bj", ...GF, to: "validated" }); // target tercapai
  const f5 = await fgReceipt("PO-PRD-2611-002", "BUIS-80", 10, "F-1C"); // melebihi target → peringatan
  await advance("F5", f5, { creator: "staff_bj", ...GF, to: "submitted" });

  // =====================================================================
  // 5. PENGIRIMAN + SURAT JALAN KELUAR (nomor SJK terbit saat validasi)
  // =====================================================================
  log("5/7 pengiriman & surat jalan");
  const d1 = await delivery("CUS-01", "UDITCH-60", 60, "F-1A", "PO-KONS-8841");
  await advance("D1", d1, { creator: "staff_bj", ...GF, to: "validated" });
  const d2 = await delivery("CUS-02", "BUIS-80", 100, "F-1C", "PO-BSJ-0192");
  await advance("D2", d2, { creator: "staff_bj", ...GF, to: "validated" });

  // pengiriman tervalidasi lalu DIBALIK (barang dikembalikan customer): surat jalan asli tetap, ditandai DIBATALKAN
  const d3 = await delivery("CUS-04", "BUIS-80", 10, "F-1C");
  await advance("D3", d3, { creator: "staff_bj", ...GF, to: "validated" });
  const d3rev = (await api.rpc("staff_bj", "create_reversal", { p_doc_id: d3, p_reason: "Barang dikembalikan customer: dimensi tidak sesuai." })) as string;
  await advance("D3-REV", d3rev, { creator: "staff_bj", ...GF, to: "validated" });

  const d4 = await delivery("CUS-01", "UDITCH-60", 40, "F-1B", "PO-KONS-8850");
  await advance("D4", d4, { creator: "staff_bj", ...GF, to: "approved" }); // menunggu validasi Kepala Gudang BJ
  await delivery("CUS-03", "UDITCH-60", 10, "F-1A", "PO-DPU-2026-77"); // draft

  // pemindahan barang jadi menunggu validasi
  const t2 = await draft("staff_bj", "STOCK_TRANSFER", { warehouse_id: wh["WH-F"] }, [line("UDITCH-60", 30, "F-1B", "F-2A")]);
  await advance("T2", t2, { creator: "staff_bj", approver: null, validator: "kagud_bj", to: "approved" });

  // =====================================================================
  // 6. STOCK OPNAME
  // =====================================================================
  log("6/7 stock opname");
  // opname selesai: hitungan fisik Bin Pasir 1 = 60 m³ sedangkan sistem 62 → penyesuaian -2
  const o1 = (await api.rpc("staff_agregat", "open_opname", {
    p_warehouse_id: wh["WH-M2"], p_location_ids: [lc["AG-P1"]], p_include_children: false, p_note: "Opname rutin bin pasir",
  })) as string;
  const o1Lines = await api.select("staff_agregat", "opname_line", { document_id: o1 });
  await api.rpc("staff_agregat", "save_opname_count", {
    p_doc_id: o1,
    p_lines: o1Lines.map((l) => ({ line_id: l.id, counted_qty: "60", note: "Susut dan ceceran saat pemuatan" })),
    p_note: "Opname rutin bin pasir",
  });
  await advance("O1", o1, { creator: "staff_agregat", ...GA, to: "validated" });

  // opname BERJALAN pada Blok 1C: penempatan terkunci, hitungan baru tersimpan sebagian (belum diajukan)
  const o2 = (await api.rpc("staff_bj", "open_opname", {
    p_warehouse_id: wh["WH-F"], p_location_ids: [lc["F-1C"]], p_include_children: false, p_note: "Opname Blok 1C (sedang berjalan)",
  })) as string;
  const o2Lines = await api.select("staff_bj", "opname_line", { document_id: o2 });
  await api.rpc("staff_bj", "save_opname_count", {
    p_doc_id: o2,
    p_lines: o2Lines.map((l) => ({ line_id: l.id, counted_qty: "49", note: "Satu buis retak, dipisahkan" })),
    p_note: null,
  });

  // =====================================================================
  // 7. PENGATURAN DASHBOARD
  // =====================================================================
  log("7/7 dashboard");
  await api.upsert(
    "dashboard_config",
    [
      {
        user_id: ref.user["kagud_agregat"],
        widgets: { keys: ["pending_decisions", "stock_by_warehouse", "low_stock", "recent_movements"], warehouse_id: wh["WH-M2"] },
      },
    ],
    ["user_id"],
  );

  const total = (await api.select(null, "document")).length;
  return { skipped: false, documents: total, warnings };
}
