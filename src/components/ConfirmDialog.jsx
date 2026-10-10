export function ConfirmDialog({ title, children, actions }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
      <div className="card" style={{ maxWidth: 520, width: "100%", padding: "18px 20px", maxHeight: "90vh", overflow: "auto" }}>
        <h3 style={{ margin: "0 0 10px 0" }}>{title}</h3>
        <div style={{ fontSize: 14, lineHeight: 1.5 }}>{children}</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end", marginTop: 16 }}>{actions}</div>
      </div>
    </div>
  );
}
