import {
  Bell,
  BookOpen,
  Bot,
  FileText,
  FolderKanban,
  LayoutDashboard,
  ListChecks,
  MessagesSquare,
  Settings,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-preact';

export interface NavEintrag {
  pfad: string;
  text: string;
  Icon: LucideIcon;
  /** Phase, in der der Bereich fertig wird (für den Hinweis „bald“) */
  phase?: number;
}

/** Die 10 Hauptbereiche aus dem Pflichtenheft (4.3) */
export const BEREICHE: NavEintrag[] = [
  { pfad: '/', text: 'Dashboard', Icon: LayoutDashboard },
  { pfad: '/mitarbeiter', text: 'KI-Mitarbeiter', Icon: Bot },
  { pfad: '/aufgaben', text: 'Aufgaben & Aufträge', Icon: ListChecks },
  { pfad: '/projekte', text: 'Projekte', Icon: FolderKanban },
  { pfad: '/kommunikation', text: 'Kommunikation', Icon: MessagesSquare },
  { pfad: '/freigaben', text: 'Entscheidungen & Freigaben', Icon: ShieldCheck },
  { pfad: '/wissen', text: 'Unternehmenswissen', Icon: BookOpen, phase: 6 },
  { pfad: '/berichte', text: 'Berichte', Icon: FileText, phase: 6 },
  { pfad: '/benachrichtigungen', text: 'Benachrichtigungen', Icon: Bell },
  { pfad: '/einstellungen', text: 'Einstellungen & Verwaltung', Icon: Settings },
];

export function istAktiv(eintrag: string, pfad: string): boolean {
  return eintrag === '/' ? pfad === '/' : pfad === eintrag || pfad.startsWith(eintrag + '/');
}
