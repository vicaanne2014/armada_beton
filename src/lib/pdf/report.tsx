import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

const s = StyleSheet.create({
  page: { padding: 28, fontSize: 8, fontFamily: "Helvetica", color: "#0f172a" },
  title: { fontSize: 14, fontFamily: "Helvetica-Bold" },
  sub: { fontSize: 8, color: "#64748b", marginTop: 2, marginBottom: 10 },
  th: { flexDirection: "row", backgroundColor: "#f1f5f9", borderTop: 1, borderBottom: 1, borderColor: "#cbd5e1" },
  tr: { flexDirection: "row", borderBottom: 1, borderColor: "#e2e8f0" },
  cell: { padding: 4, flex: 1 },
  foot: { position: "absolute", bottom: 14, left: 28, right: 28, fontSize: 7, color: "#94a3b8", flexDirection: "row", justifyContent: "space-between" },
});

export function ReportPdf({
  title,
  subtitle,
  columns,
  rows,
}: {
  title: string;
  subtitle: string;
  columns: Array<{ label: string; numeric: boolean }>;
  rows: string[][];
}) {
  return (
    <Document title={title}>
      <Page size="A4" orientation="landscape" style={s.page}>
        <Text style={s.title}>{title}</Text>
        <Text style={s.sub}>{subtitle}</Text>
        <View style={s.th} fixed>
          {columns.map((c, i) => (
            <Text key={i} style={[s.cell, c.numeric ? { textAlign: "right" } : {}]}>{c.label}</Text>
          ))}
        </View>
        {rows.map((r, ri) => (
          <View key={ri} style={s.tr} wrap={false}>
            {r.map((v, ci) => (
              <Text key={ci} style={[s.cell, columns[ci].numeric ? { textAlign: "right" } : {}]}>{v}</Text>
            ))}
          </View>
        ))}
        <View style={s.foot} fixed>
          <Text>WMS Batching Plant — {rows.length} baris</Text>
          <Text render={({ pageNumber, totalPages }) => `Hal. ${pageNumber}/${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
