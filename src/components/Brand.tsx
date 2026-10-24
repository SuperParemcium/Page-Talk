export function Brand({ compact = false, light = false }: { compact?: boolean; light?: boolean }) {
  return (
    <div className={`brand ${compact ? "is-compact" : ""} ${light ? "is-light" : ""}`}>
      <div className="brand-seal" aria-hidden="true">
        <span>间</span>
        <i />
      </div>
      {!compact && (
        <div className="brand-wordmark">
          <strong>页间</strong>
          <span>PAGE TALK</span>
        </div>
      )}
    </div>
  );
}
