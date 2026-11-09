const qtyFmt = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 4 });
export const fmtQty = (v: number | string | null | undefined) =>
  v === null || v === undefined || v === "" ? "-" : qtyFmt.format(Number(v));

export const fmtDate = (v: string | null | undefined) =>
  v
    ? new Date(v).toLocaleDateString("id-ID", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "Asia/Jakarta",
      })
    : "-";

export const fmtDateTime = (v: string | null | undefined) =>
  v
    ? new Date(v).toLocaleString("id-ID", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Jakarta",
      })
    : "-";

export const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  MENUNGGU_APPROVAL: "Menunggu Approval",
  MENUNGGU_VALIDASI: "Menunggu Validasi",
  DIKEMBALIKAN: "Dikembalikan",
  DITOLAK: "Ditolak",
  TERVALIDASI: "Tervalidasi",
};

export type Tone = "gray" | "amber" | "blue" | "red" | "green" | "orange";
export const STATUS_TONE: Record<string, Tone> = {
  DRAFT: "gray",
  MENUNGGU_APPROVAL: "amber",
  MENUNGGU_VALIDASI: "blue",
  DIKEMBALIKAN: "orange",
  DITOLAK: "red",
  TERVALIDASI: "green",
};

export const STEP_LABEL: Record<string, string> = {
  KEPALA_DEPT: "Approval Kepala Departemen",
  KEPALA_GUDANG: "Validasi Kepala Gudang",
};

export const DECISION_LABEL: Record<string, string> = {
  PENDING: "Menunggu",
  APPROVED: "Disetujui",
  RETURNED: "Dikembalikan",
  REJECTED: "Ditolak",
  SKIPPED: "Dilewati",
};
