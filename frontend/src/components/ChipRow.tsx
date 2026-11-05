import { useLayoutEffect, useRef, type ReactNode } from "react";

/**
 * Fila de botões de filtro que rola para o lado. A opção marcada é trazida
 * para a área visível (ao abrir a tela e a cada mudança): com muitas pessoas,
 * a escolhida podia ficar escondida à direita e parecer que nada estava marcado.
 */
export function ChipRow({ label, role = "group", children }: { label: string; role?: "group" | "radiogroup"; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const row = ref.current;
    const on = row?.querySelector<HTMLElement>(".chip-on, [aria-checked='true']");
    if (!row || !on) return;
    // Só a fila rola (scrollIntoView rolaria a página inteira).
    const left = on.offsetLeft - row.offsetLeft;
    const right = left + on.offsetWidth;
    if (left < row.scrollLeft) row.scrollLeft = Math.max(0, left - 16);
    else if (right > row.scrollLeft + row.clientWidth) row.scrollLeft = right - row.clientWidth + 16;
  });
  return <div ref={ref} className="chips" role={role} aria-label={label}>{children}</div>;
}
