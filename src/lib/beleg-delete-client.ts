import { deleteBelegAction } from "@/app/dashboard/belege/manual-actions";

/**
 * Löscht einen manuellen Beleg über `deleteBelegAction` – fragt bei bereits
 * bezahlten Belegen zusätzlich noch einmal explizit nach (Sperre gegen
 * versehentliches Löschen), bevor es tatsächlich passiert. Gibt true zurück,
 * wenn gelöscht wurde, false bei Abbruch/Fehler.
 */
export async function confirmAndDeleteBeleg(id: number, label: string): Promise<boolean> {
  if (!window.confirm(`Beleg „${label}" (#${id}) wirklich löschen?`)) return false;
  const fd = new FormData();
  fd.set("id", String(id));
  let res = await deleteBelegAction(fd);
  if (!res.ok && res.requiresPaidConfirm) {
    if (!window.confirm(`${res.error}`)) return false;
    fd.set("confirmPaid", "1");
    res = await deleteBelegAction(fd);
  }
  if (!res.ok && res.error) alert(res.error);
  return res.ok;
}
