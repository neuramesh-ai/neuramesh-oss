// One navigation for every session. Intake chooses the runtime; the rail never filters it.
export interface NavDestRow { key: string; label: string; on: boolean; inside?: string }
export interface NavDestInput { nav: string; view: string }
export const SCHEDULED_VIEWS = ['automations', 'calendar'] as const;
export const isScheduledView = (nav: string, view: string): boolean =>
  nav === 'home' && (SCHEDULED_VIEWS as readonly string[]).includes(view);
export const CUSTOMIZATIONS_VIEWS = ['skills', 'connections'] as const;
export const isCustomizationsView = (nav: string, view: string): boolean =>
  nav === 'home' && (CUSTOMIZATIONS_VIEWS as readonly string[]).includes(view);
export function navMoreRows({ nav, view }: NavDestInput): NavDestRow[] {
  const home = nav === 'home';
  return [
    { key: 'whiteboards', label: 'Whiteboards', on: home && view === 'whiteboards' },
    { key: 'library', label: 'Files', on: nav === 'artifacts' },
    { key: 'tasks', label: 'Tasks', on: home && view === 'board' },
    { key: 'legacy', label: 'Legacy coding sessions', on: home && view === 'engineering' },
    { key: 'worktrees', label: 'Worktrees', on: home && view === 'worktrees' },
  ];
}
export function navDestRows({ nav, view }: NavDestInput): NavDestRow[] {
  const home = nav === 'home';
  const inside = navMoreRows({ nav, view }).find((r) => r.on);
  return [
    { key: 'marketing', label: 'Marketing', on: home && view === 'marketing' },
    { key: 'finance', label: 'Finance', on: home && view === 'finance' },
    { key: 'team', label: 'Agent Desk', on: nav === 'agents' },
    { key: 'scheduled', label: 'Automations', on: isScheduledView(nav, view) },
    { key: 'customizations', label: 'Customizations', on: isCustomizationsView(nav, view) },
    { key: 'more', label: 'More', on: !!inside, ...(inside ? { inside: inside.label } : {}) },
  ];
}
