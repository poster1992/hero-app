"use client";

import { useState, useTransition } from "react";
import { generateCredentialsAction } from "@/app/dashboard/benutzer/actions";

const RED: [number, number, number] = [232, 57, 42];
const INK: [number, number, number] = [32, 36, 42];
const GRAY: [number, number, number] = [107, 114, 128];

/** Lädt das Floortec-Logo als DataURL (für die Einbettung ins PDF). */
async function loadLogo(): Promise<string | null> {
  try {
    const res = await fetch("/logo.png", { cache: "force-cache" });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/** Erzeugt das gebrandete Zugangsdaten-PDF und lädt es herunter. */
async function buildPdf(data: { displayName: string; username: string; password: string; roleLabel: string }) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = 210;
  const mL = 20;
  let y = 22;

  const logo = await loadLogo();
  if (logo) {
    const w = 58;
    const h = w * (651 / 1920); // Original-Seitenverhältnis
    doc.addImage(logo, "PNG", mL, y, w, h);
    y += h + 8;
  } else {
    y += 6;
  }

  // Trennlinie
  doc.setDrawColor(231, 233, 236);
  doc.line(mL, y, W - mL, y);
  y += 12;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...RED);
  doc.text("PERSÖNLICHE ZUGANGSDATEN", mL, y);
  y += 9;

  doc.setFontSize(24);
  doc.setTextColor(...INK);
  doc.text("FLOORTEC Dashboard", mL, y);
  y += 7;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(...GRAY);
  doc.text("Bitte vertraulich behandeln – nicht weitergeben.", mL, y);
  y += 14;

  doc.setFontSize(11);
  doc.setTextColor(...GRAY);
  doc.text("Für:", mL, y);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.setTextColor(...INK);
  doc.text(data.displayName, mL + 14, y + 0.5);
  y += 12;

  // Karten-Box
  const boxX = mL;
  const boxW = W - 2 * mL;
  const boxY = y;
  const rowH = 16;
  const rows: [string, string, boolean][] = [
    ["ADRESSE", "floortec.pascaloster.de", false],
    ["BENUTZERNAME", data.username, true],
    ["PASSWORT", data.password, true],
    ["BEREICH", data.roleLabel, false],
  ];
  const boxH = rows.length * rowH + 6;
  doc.setDrawColor(231, 233, 236);
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(boxX, boxY, boxW, boxH, 3, 3, "S");
  // roter Balken oben
  doc.setFillColor(...RED);
  doc.rect(boxX, boxY, boxW, 2, "F");

  let ry = boxY + 10;
  rows.forEach(([lbl, val, mono], i) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...GRAY);
    doc.text(lbl, boxX + 8, ry + 2);
    if (mono) {
      doc.setFont("courier", "bold");
      doc.setFontSize(15);
    } else {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
    }
    doc.setTextColor(...INK);
    doc.text(val, boxX + 55, ry + 2.5);
    if (i < rows.length - 1) {
      doc.setDrawColor(240, 241, 243);
      doc.line(boxX + 8, ry + rowH - 6, boxX + boxW - 8, ry + rowH - 6);
    }
    ry += rowH;
  });
  y = boxY + boxH + 14;

  // Anleitung
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...INK);
  doc.text("So meldest du dich an", mL, y);
  y += 7;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(63, 70, 80);
  const steps = [
    "1.  Am Handy den Browser öffnen und floortec.pascaloster.de eingeben.",
    "2.  Mit Benutzername und Passwort (siehe oben) anmelden.",
    "3.  Optional: die App auf den Startbildschirm legen (Menü → Hilfe).",
  ];
  for (const s of steps) {
    doc.text(s, mL, y);
    y += 7;
  }
  y += 4;
  doc.setFillColor(255, 246, 245);
  doc.setDrawColor(240, 217, 214);
  doc.roundedRect(mL, y, W - 2 * mL, 16, 2, 2, "FD");
  doc.setFontSize(9.5);
  doc.setTextColor(138, 75, 70);
  doc.text(
    'Auf Groß-/Kleinschreibung und Sonderzeichen achten. Der Bindestrich "-" gehört zum Passwort.',
    mL + 5,
    y + 7
  );
  doc.text("Bei Problemen im Büro melden.", mL + 5, y + 12);

  // Fußzeile
  doc.setDrawColor(231, 233, 236);
  doc.line(mL, 285, W - mL, 285);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...GRAY);
  doc.text("FLOORTEC.design", mL, 290);
  doc.text("Zugangsdaten · vertraulich", W - mL, 290, { align: "right" });

  const safe = data.displayName.replace(/[^A-Za-z0-9]+/g, "_");
  doc.save(`Zugangsdaten-${safe}.pdf`);
}

export default function CredentialPdfButton({ userId, roleLabel }: { userId: number; roleLabel: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const onClick = () => {
    if (
      !window.confirm(
        "Neues Passwort erzeugen und Zugangsdaten-PDF erstellen?\n\nAchtung: Das bisherige Passwort des Benutzers wird dabei ersetzt."
      )
    )
      return;
    setMsg(null);
    start(async () => {
      const fd = new FormData();
      fd.set("id", String(userId));
      const res = await generateCredentialsAction(fd);
      if (!res.ok || !res.password || !res.username) {
        setMsg({ ok: false, text: res.error ?? "Fehlgeschlagen." });
        return;
      }
      try {
        await buildPdf({
          displayName: res.displayName ?? res.username,
          username: res.username,
          password: res.password,
          roleLabel: roleLabel || res.role || "—",
        });
        setMsg({ ok: true, text: "PDF erstellt" });
      } catch {
        setMsg({ ok: false, text: "PDF-Erstellung fehlgeschlagen." });
      }
    });
  };

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        title="Neues Passwort setzen und gebrandetes Zugangsdaten-PDF herunterladen"
        className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 transition-colors hover:border-brand-red/50 hover:text-gray-900 disabled:opacity-50"
      >
        {pending ? "…" : "🔑 Zugangs-PDF"}
      </button>
      {msg && <span className={`text-xs ${msg.ok ? "text-emerald-600" : "text-rose-600"}`}>{msg.text}</span>}
    </span>
  );
}
