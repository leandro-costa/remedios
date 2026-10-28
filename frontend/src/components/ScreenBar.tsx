import { useNavigate } from "react-router";
import { Icon } from "./Icon";

/** Topo das telas internas (como a tela Dose do design): voltar à esquerda, título ao centro. */
export function ScreenBar({ title, onBack }: { title: string; onBack?: () => void }) {
  const navigate = useNavigate();
  return (
    <header className="screen-bar">
      <button className="round-btn light" aria-label="Voltar" onClick={onBack ?? (() => navigate(-1))}>
        <Icon name="back" />
      </button>
      <h1 className="screen-bar-title">{title}</h1>
      <span aria-hidden="true" />
    </header>
  );
}
