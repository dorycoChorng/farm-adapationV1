import type { Language } from './index';

/**
 * Dates and place names in the interface language. Dates are formatted here rather
 * than with toLocaleDateString because Khmer locale data is missing from some
 * JavaScript engines (they fall back to English), which left English dates in Khmer mode.
 */

const MONTHS: Record<Language, string[]> = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  km: ['មករា', 'កុម្ភៈ', 'មីនា', 'មេសា', 'ឧសភា', 'មិថុនា', 'កក្កដា', 'សីហា', 'កញ្ញា', 'តុលា', 'វិច្ឆិកា', 'ធ្នូ'],
};

const pad = (n: number) => String(n).padStart(2, '0');

/** "19 Oct 2026" / "19 តុលា 2026"; with time, "19 Oct 2026, 14:05". */
export function formatDate(value: string | number | Date, language: Language, withTime = false): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '–';
  const date = `${d.getDate()} ${MONTHS[language][d.getMonth()]} ${d.getFullYear()}`;
  return withTime ? `${date}, ${pad(d.getHours())}:${pad(d.getMinutes())}` : date;
}

/** A place's name in the interface language, when a Khmer name is known (countries from the bundled index). */
export function localName(place: { name: string | null; nameKm?: string | null }, language: Language): string | null {
  return (language === 'km' ? place.nameKm : null) ?? place.name;
}
