/** TE-Digital-Zeichen (Ebenen-Stapel) aus te-alltagshelfer.org */
export function MarkenZeichen({ groesse = 17 }: { groesse?: number }) {
  return (
    <svg width={groesse} height={groesse} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 2 2 7l10 5 10-5-10-5Z" fill="currentColor" />
      <path d="M2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

export function MarkenKachel({ groesse = 32 }: { groesse?: number }) {
  return (
    <span class="marke-kachel" style={{ width: groesse, height: groesse, borderRadius: Math.round(groesse * 0.28) }}>
      <MarkenZeichen groesse={Math.round(groesse * 0.53)} />
    </span>
  );
}
