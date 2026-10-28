/** Cores dos avatares (fundo claro, inicial em tinta: contraste AA nos dois temas). */
const COLORS = ["#CDE7F7", "#F9D9C7", "#7FD3BC", "#F7CF7A", "#E6E3FA", "#DDF1EA"];

function colorFor(key: string): string {
  let hash = 0;
  for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[hash % COLORS.length];
}

/** Inicial da pessoa num círculo colorido (decorativo: o nome aparece ao lado). */
export function Avatar({ name, id, size = 44 }: { name: string; id: string; size?: number }) {
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <span className="avatar" aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4), background: colorFor(id) }}>
      {initial}
    </span>
  );
}
