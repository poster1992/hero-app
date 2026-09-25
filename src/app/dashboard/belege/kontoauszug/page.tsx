import { redirect } from "next/navigation";

/**
 * Umgezogen: Kontoauszüge laufen jetzt als eigenständiges Fenster ohne
 * Dashboard-Menü unter /kontoauszuege (siehe MonthlyReceipts.tsx-Link,
 * öffnet in neuem Tab). Diese alte URL leitet nur noch dorthin weiter,
 * falls sie irgendwo noch verlinkt/als Lesezeichen gespeichert ist.
 */
export default function KontoauszugRedirectPage() {
  redirect("/kontoauszuege");
}
