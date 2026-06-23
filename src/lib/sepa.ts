// Erzeugt eine SEPA-Überweisungsdatei (pain.001.001.03) für den Import in Multiline.

export interface SepaPayment {
  creditorName: string;
  creditorIban: string;
  creditorBic: string | null;
  amount: number; // in EUR
  reference: string; // Verwendungszweck (z. B. Beleg-Nr.)
  endToEndId: string;
}

export interface SepaInput {
  debtorName: string;
  debtorIban: string;
  debtorBic: string | null;
  /** Ausführungsdatum YYYY-MM-DD. */
  executionDate: string;
  msgId: string;
  payments: SepaPayment[];
}

const AMOUNT = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Auf den von SEPA erlaubten Zeichensatz reduzieren (Umlaute transliterieren). */
export function sepaText(s: string, maxLen = 140): string {
  const map: Record<string, string> = {
    ä: "ae", ö: "oe", ü: "ue", Ä: "Ae", Ö: "Oe", Ü: "Ue", ß: "ss", "€": "EUR",
  };
  const t = s
    .replace(/[äöüÄÖÜß€]/g, (c) => map[c] ?? c)
    .replace(/[^a-zA-Z0-9/\-?:().,'+ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t.slice(0, maxLen);
}

const clean = (s: string) => s.replace(/\s+/g, "").toUpperCase();

export function buildSepaCreditTransfer(input: SepaInput): string {
  const total = input.payments.reduce((s, p) => s + p.amount, 0);
  const nb = input.payments.length;
  const creDtTm = new Date().toISOString().replace(/\.\d+Z$/, "Z");

  const tx = input.payments
    .map((p) => {
      const cdtrAgt = p.creditorBic
        ? `        <CdtrAgt><FinInstnId><BIC>${clean(p.creditorBic)}</BIC></FinInstnId></CdtrAgt>\n`
        : "";
      return (
        `      <CdtTrfTxInf>\n` +
        `        <PmtId><EndToEndId>${xmlEscape(sepaText(p.endToEndId, 35))}</EndToEndId></PmtId>\n` +
        `        <Amt><InstdAmt Ccy="EUR">${AMOUNT(p.amount)}</InstdAmt></Amt>\n` +
        cdtrAgt +
        `        <Cdtr><Nm>${xmlEscape(sepaText(p.creditorName, 70))}</Nm></Cdtr>\n` +
        `        <CdtrAcct><Id><IBAN>${clean(p.creditorIban)}</IBAN></Id></CdtrAcct>\n` +
        `        <RmtInf><Ustrd>${xmlEscape(sepaText(p.reference, 140))}</Ustrd></RmtInf>\n` +
        `      </CdtTrfTxInf>`
      );
    })
    .join("\n");

  const dbtrAgt = input.debtorBic
    ? `      <DbtrAgt><FinInstnId><BIC>${clean(input.debtorBic)}</BIC></FinInstnId></DbtrAgt>\n`
    : `      <DbtrAgt><FinInstnId><Othr><Id>NOTPROVIDED</Id></Othr></FinInstnId></DbtrAgt>\n`;

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n` +
    `  <CstmrCdtTrfInitn>\n` +
    `    <GrpHdr>\n` +
    `      <MsgId>${xmlEscape(input.msgId)}</MsgId>\n` +
    `      <CreDtTm>${creDtTm}</CreDtTm>\n` +
    `      <NbOfTxs>${nb}</NbOfTxs>\n` +
    `      <CtrlSum>${AMOUNT(total)}</CtrlSum>\n` +
    `      <InitgPty><Nm>${xmlEscape(sepaText(input.debtorName, 70))}</Nm></InitgPty>\n` +
    `    </GrpHdr>\n` +
    `    <PmtInf>\n` +
    `      <PmtInfId>${xmlEscape(input.msgId)}</PmtInfId>\n` +
    `      <PmtMtd>TRF</PmtMtd>\n` +
    `      <BtchBookg>false</BtchBookg>\n` +
    `      <NbOfTxs>${nb}</NbOfTxs>\n` +
    `      <CtrlSum>${AMOUNT(total)}</CtrlSum>\n` +
    `      <PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl></PmtTpInf>\n` +
    `      <ReqdExctnDt>${input.executionDate}</ReqdExctnDt>\n` +
    `      <Dbtr><Nm>${xmlEscape(sepaText(input.debtorName, 70))}</Nm></Dbtr>\n` +
    `      <DbtrAcct><Id><IBAN>${clean(input.debtorIban)}</IBAN></Id></DbtrAcct>\n` +
    dbtrAgt +
    `      <ChrgBr>SLEV</ChrgBr>\n` +
    tx +
    `\n    </PmtInf>\n` +
    `  </CstmrCdtTrfInitn>\n` +
    `</Document>\n`
  );
}
