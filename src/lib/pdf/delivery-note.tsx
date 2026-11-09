import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

const s = StyleSheet.create({
  page: { padding: 36, fontSize: 10, fontFamily: "Helvetica", color: "#0f172a" },
  head: { flexDirection: "row", justifyContent: "space-between", marginBottom: 18 },
  title: { fontSize: 20, fontFamily: "Helvetica-Bold" },
  sub: { fontSize: 9, color: "#475569", marginTop: 2 },
  meta: { flexDirection: "row", marginBottom: 14, gap: 24 },
  metaCol: { flex: 1 },
  label: { fontSize: 8, color: "#64748b", textTransform: "uppercase", marginBottom: 2 },
  value: { fontSize: 10, marginBottom: 6 },
  th: { flexDirection: "row", backgroundColor: "#f1f5f9", borderTop: 1, borderBottom: 1, borderColor: "#cbd5e1" },
  tr: { flexDirection: "row", borderBottom: 1, borderColor: "#e2e8f0" },
  cell: { padding: 6 },
  sign: { flexDirection: "row", marginTop: 48, gap: 16 },
  signBox: { flex: 1, alignItems: "center" },
  signLine: { marginTop: 44, borderTop: 1, borderColor: "#0f172a", width: "100%", paddingTop: 4, textAlign: "center" },
  void: {
    position: "absolute",
    top: 330,
    left: 90,
    fontSize: 72,
    color: "#fca5a5",
    transform: "rotate(-25deg)",
    fontFamily: "Helvetica-Bold",
  },
});

export interface DeliveryNotePdfData {
  sjNumber: string;
  deliveryDate: string;
  customerName: string;
  customerAddress: string | null;
  customerPoRef: string | null;
  warehouseName: string;
  docNo: string;
  voided: boolean;
  lines: Array<{ no: number; code: string; name: string; qty: string; uom: string; location: string }>;
  createdBy: string;
  approvedBy: string;
  validatedBy: string;
}

export function DeliveryNotePdf({ d }: { d: DeliveryNotePdfData }) {
  return (
    <Document title={`Surat Jalan ${d.sjNumber}`}>
      <Page size="A4" style={s.page}>
        <View style={s.head}>
          <View>
            <Text style={s.title}>SURAT JALAN</Text>
            <Text style={s.sub}>Batching Plant Beton — Gudang Barang Jadi</Text>
          </View>
          <View>
            <Text style={s.label}>Nomor</Text>
            <Text style={{ fontSize: 13, fontFamily: "Helvetica-Bold" }}>{d.sjNumber}</Text>
          </View>
        </View>

        <View style={s.meta}>
          <View style={s.metaCol}>
            <Text style={s.label}>Kepada</Text>
            <Text style={s.value}>{d.customerName}</Text>
            {d.customerAddress ? <Text style={s.value}>{d.customerAddress}</Text> : null}
            {d.customerPoRef ? (
              <>
                <Text style={s.label}>Ref. PO Customer</Text>
                <Text style={s.value}>{d.customerPoRef}</Text>
              </>
            ) : null}
          </View>
          <View style={s.metaCol}>
            <Text style={s.label}>Tanggal Kirim</Text>
            <Text style={s.value}>{d.deliveryDate}</Text>
            <Text style={s.label}>Gudang</Text>
            <Text style={s.value}>{d.warehouseName}</Text>
            <Text style={s.label}>No. Dokumen Internal</Text>
            <Text style={s.value}>{d.docNo}</Text>
          </View>
        </View>

        <View style={s.th}>
          <Text style={[s.cell, { width: 30 }]}>No</Text>
          <Text style={[s.cell, { width: 80 }]}>Kode</Text>
          <Text style={[s.cell, { flex: 1 }]}>Nama Barang</Text>
          <Text style={[s.cell, { width: 90 }]}>Penempatan</Text>
          <Text style={[s.cell, { width: 80, textAlign: "right" }]}>Jumlah</Text>
        </View>
        {d.lines.map((l) => (
          <View key={l.no} style={s.tr} wrap={false}>
            <Text style={[s.cell, { width: 30 }]}>{l.no}</Text>
            <Text style={[s.cell, { width: 80 }]}>{l.code}</Text>
            <Text style={[s.cell, { flex: 1 }]}>{l.name}</Text>
            <Text style={[s.cell, { width: 90 }]}>{l.location}</Text>
            <Text style={[s.cell, { width: 80, textAlign: "right" }]}>
              {l.qty} {l.uom}
            </Text>
          </View>
        ))}

        <View style={s.sign} wrap={false}>
          <View style={s.signBox}>
            <Text>Dibuat oleh</Text>
            <Text style={s.signLine}>{d.createdBy}</Text>
          </View>
          <View style={s.signBox}>
            <Text>Disetujui</Text>
            <Text style={s.signLine}>{d.approvedBy}</Text>
          </View>
          <View style={s.signBox}>
            <Text>Divalidasi Kepala Gudang</Text>
            <Text style={s.signLine}>{d.validatedBy}</Text>
          </View>
          <View style={s.signBox}>
            <Text>Diterima</Text>
            <Text style={s.signLine}>(                    )</Text>
          </View>
        </View>

        {d.voided ? <Text style={s.void}>DIBATALKAN</Text> : null}
      </Page>
    </Document>
  );
}
