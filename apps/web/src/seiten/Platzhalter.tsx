import { Construction } from 'lucide-preact';
import { Karte, Leer } from '../komponenten/Bausteine';
import { useKopf } from '../lib/kopf';

const INHALT: Record<number, string> = {
  3: 'Aufgaben mit Übergabepaketen, Kommunikation zwischen den Mitarbeitern, Entscheidungsprotokolle und Freigaben mit Passkey-Bestätigung.',
  4: 'Push-Benachrichtigungen (kritisch, wichtig, Tagesbericht) mit einstellbaren Kategorien und Ruhezeiten.',
  6: 'Unternehmens- und Projektwissen, Checkpoints, Kontextpakete und automatische Tagesberichte.',
};

export function Platzhalter({ titel, phase }: { titel: string; phase: number }) {
  useKopf(titel, `Phase ${phase}`);
  return (
    <Karte>
      <Leer Icon={Construction} titel={`${titel} folgt in Phase ${phase}`} text={INHALT[phase] ?? ''}>
        <a class="btn btn-ghost btn-sm" href="/">Zum Dashboard</a>
      </Leer>
    </Karte>
  );
}

export function NichtGefunden() {
  useKopf('Nicht gefunden');
  return (
    <Karte>
      <Leer Icon={Construction} titel="Diese Seite gibt es nicht">
        <a class="btn btn-ghost btn-sm" href="/">Zum Dashboard</a>
      </Leer>
    </Karte>
  );
}
