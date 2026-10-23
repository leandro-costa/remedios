import { useEffect, useState } from "react";
import type { OutboxItem } from "../db/db";
import { onOutboxChange, pendingFor } from "../sync/outbox";

/** Registros deste aparelho ainda não confirmados pelo servidor. */
export function useOutbox(familyId: string): OutboxItem[] {
  const [items, setItems] = useState<OutboxItem[]>([]);
  useEffect(() => {
    let active = true;
    const load = () => void pendingFor(familyId).then((list) => active && setItems(list));
    load();
    const unsubscribe = onOutboxChange(load);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [familyId]);
  return items;
}
