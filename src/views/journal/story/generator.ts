import { genId } from '../../../firebase/db.ts';
import type { JournalStoryModule, JournalStoryQuestion } from '../../../data/schema.ts';
import type { StoredJournalEntry } from '../../../data/stores/journal-store.ts';
import type { StoredLeg } from '../../../data/stores/route-store.ts';
import { excerpt, titleFor } from '../shared/utils.ts';
import { postJson } from '../../../core/api.ts';
import { aiLanguage } from '../../../core/i18n.ts';
import { currentTripId } from '../../../data/trip-context.ts';
import type { GeneratedStoryDraft } from './types.ts';

interface StorySourcePayload {
  tripLabel: string;
  entries: Array<{
    id: string;
    template: string;
    title: string;
    body: string;
    destination: string;
    tags: string[];
    happenedOn: string;
    favorite: boolean;
  }>;
}

export async function generateStoryDraft(
  entries: StoredJournalEntry[],
  legs: StoredLeg[],
): Promise<GeneratedStoryDraft> {
  const heuristic = buildHeuristicDraft(entries, legs);
  if (entries.length < 2) return heuristic;

  try {
    const aiDraft = await fetchAiDraft(entries, legs, heuristic);
    return aiDraft ?? heuristic;
  } catch (error) {
    console.warn('Story AI generation fell back to heuristic mode:', error);
    return heuristic;
  }
}

function buildHeuristicDraft(entries: StoredJournalEntry[], legs: StoredLeg[]): GeneratedStoryDraft {
  const topEntries = rankEntries(entries).slice(0, 10);
  const topPlaces = topCounts(entries.map((entry) => entry.destination.trim()).filter(Boolean), 3);
  const topTags = topCounts(entries.flatMap((entry) => entry.tags), 4);
  const templateCounts = topCounts(entries.map((entry) => entry.template), 5);
  const dominantTemplate = templateCounts[0]?.value ?? 'moment';
  const travelerMode = travelerModeFor(dominantTemplate, topTags.map((tag) => tag.value));
  const tripLabel = scopeLabelFor(legs, entries);
  const leadPlace = topPlaces[0]?.value ?? 'the trip';
  const line = recapLineFor(leadPlace, travelerMode, topTags.map((tag) => tag.value));
  const modules = buildModules(topEntries, topPlaces, topTags, travelerMode);
  const questions = buildQuestions(topEntries, topPlaces.map((place) => place.value));

  return {
    title: titleForTrip(leadPlace, travelerMode),
    subtitle: `${entries.length} fragments across ${Math.max(topPlaces.length, 1)} places, turned into a recap instead of a diary.`,
    recapLine: line,
    travelerMode,
    scopeLabel: tripLabel,
    entryIds: topEntries.map((entry) => entry.id),
    modules,
    questions,
  };
}

async function fetchAiDraft(
  entries: StoredJournalEntry[],
  legs: StoredLeg[],
  heuristic: GeneratedStoryDraft,
): Promise<GeneratedStoryDraft | null> {
  const payload: StorySourcePayload = {
    tripLabel: scopeLabelFor(legs, entries),
    entries: rankEntries(entries).slice(0, 18).map((entry) => ({
      id: entry.id,
      template: entry.template,
      title: titleFor(entry),
      body: excerpt(entry.body, 140),
      destination: entry.destination,
      tags: entry.tags,
      happenedOn: entry.happenedOn,
      favorite: entry.favorite,
    })),
  };

  const prompt = `You are generating a playful but insightful travel recap for a solo traveller.
Return ONLY valid JSON matching this exact shape:
{
  "title": "short title",
  "subtitle": "one sentence subtitle",
  "recapLine": "one-line trip summary",
  "travelerMode": "short archetype label",
  "modules": [
    { "type": "string", "title": "short heading", "summary": "2-3 sentence summary", "entryIds": ["id1", "id2"] }
  ],
  "questions": [
    { "prompt": "question text", "entryId": "optional id or null" }
  ]
}

Constraints:
- Do NOT rewrite the trip chronologically.
- Make it feel like an annual recap: thematic, a little witty, but grounded.
- Produce 4 to 6 modules.
- Produce 3 to 5 questions.
- Only use entryIds from the provided payload.
- Questions should often reference one existing entry directly.

Payload:
${JSON.stringify(payload)}`;

  const parsed = await postJson<any>('/api/story', { prompt, lang: aiLanguage(), tripId: currentTripId() });

  const validIds = new Set(entries.map((entry) => entry.id));
  const modules = Array.isArray(parsed.modules)
    ? parsed.modules
        .map((module: any, index: number): JournalStoryModule => ({
          id: genId(),
          type: String(module?.type || `module-${index + 1}`),
          title: String(module?.title || heuristic.modules[index]?.title || 'Highlight'),
          summary: String(module?.summary || ''),
          entryIds: Array.isArray(module?.entryIds)
            ? module.entryIds.filter((id: string) => validIds.has(id)).slice(0, 3)
            : [],
        }))
        .filter((module: JournalStoryModule) => module.summary.trim())
    : [];

  const questions = Array.isArray(parsed.questions)
    ? parsed.questions
        .map((question: any): JournalStoryQuestion => ({
          id: genId(),
          prompt: String(question?.prompt || ''),
          entryId: validIds.has(question?.entryId) ? question.entryId : null,
          answer: '',
        }))
        .filter((question: JournalStoryQuestion) => question.prompt.trim())
    : [];

  if (!modules.length) return null;

  const generated: GeneratedStoryDraft = {
    ...heuristic,
    title: String(parsed.title || heuristic.title),
    subtitle: String(parsed.subtitle || heuristic.subtitle),
    recapLine: String(parsed.recapLine || heuristic.recapLine),
    travelerMode: String(parsed.travelerMode || heuristic.travelerMode),
    modules: modules.slice(0, 6),
    questions: questions.length ? questions.slice(0, 5) : heuristic.questions,
    entryIds: dedupeIds(modules.flatMap((module: JournalStoryModule) => module.entryIds)).slice(0, 18),
  };
  return generated;
}

function buildModules(
  topEntries: StoredJournalEntry[],
  topPlaces: Array<{ value: string; count: number }>,
  topTags: Array<{ value: string; count: number }>,
  travelerMode: string,
): JournalStoryModule[] {
  const momentEntries = topEntries.filter((entry) => entry.template === 'moment' || entry.template === 'spark');
  const placeEntries = topEntries.filter((entry) => entry.destination.trim());
  const interestingEntries = topEntries.filter((entry) => entry.template === 'interesting');
  const noteEntries = topEntries.filter((entry) => entry.template === 'note');

  return [
    {
      id: genId(),
      type: 'trip-line',
      title: 'Trip in One Line',
      summary: `${travelerMode} energy from start to finish: less “here is the itinerary”, more “here is the texture that kept following you around.”`,
      entryIds: topEntries.slice(0, 2).map((entry) => entry.id),
    },
    {
      id: genId(),
      type: 'moments',
      title: 'Moments That Stayed',
      summary: summaryFromEntries(momentEntries.length ? momentEntries : topEntries.slice(0, 3)),
      entryIds: (momentEntries.length ? momentEntries : topEntries).slice(0, 3).map((entry) => entry.id),
    },
    {
      id: genId(),
      type: 'places',
      title: 'Places With A Point Of View',
      summary: topPlaces.length
        ? `${topPlaces.map((place) => place.value).join(', ')} were not just stops on the route. They each pulled a different version of you into focus.`
        : 'A few places quietly became more than locations. They worked like mirrors for the trip itself.',
      entryIds: placeEntries.slice(0, 3).map((entry) => entry.id),
    },
    {
      id: genId(),
      type: 'tiny-things',
      title: 'Tiny Things, Big Memory',
      summary: summaryFromEntries(noteEntries.length ? noteEntries : interestingEntries.slice(0, 2)),
      entryIds: (noteEntries.length ? noteEntries : interestingEntries).slice(0, 3).map((entry) => entry.id),
    },
    {
      id: genId(),
      type: 'change',
      title: 'What Changed',
      summary: topTags.length
        ? `By the end, the trip kept circling back to ${topTags.slice(0, 2).map((tag) => `#${tag.value}`).join(' and ')}. That usually means the journey was shaping your attention, not just filling your camera roll.`
        : 'The shift was subtle: the later notes felt less like collecting and more like noticing. That is usually where the real trip begins.',
      entryIds: topEntries.slice(-3).map((entry) => entry.id),
    },
  ].filter((module) => module.entryIds.length > 0 || module.summary.trim());
}

function buildQuestions(
  entries: StoredJournalEntry[],
  places: string[],
): JournalStoryQuestion[] {
  const candidates = entries.slice(0, 5);
  const questions: JournalStoryQuestion[] = [];

  for (const entry of candidates) {
    const prompt = questionForEntry(entry);
    if (!prompt) continue;
    questions.push({
      id: genId(),
      prompt,
      answer: '',
      entryId: entry.id,
    });
    if (questions.length >= 4) break;
  }

  if (questions.length < 3) {
    questions.push({
      id: genId(),
      prompt: `If one place had to stand in for the whole trip, would you choose ${places[0] || 'this trip'}? Why or why not?`,
      answer: '',
      entryId: null,
    });
  }

  return questions.slice(0, 5);
}

function questionForEntry(entry: StoredJournalEntry): string {
  const label = titleFor(entry);
  if (entry.template === 'interesting') {
    return `You marked "${label}" as interesting. Why did it feel more revealing than random in hindsight?`;
  }
  if (entry.template === 'moment' || entry.template === 'spark') {
    return `When you wrote "${label}", what feeling were you trying to catch before it disappeared?`;
  }
  if (entry.template === 'place') {
    return `${entry.destination || 'This place'} made it into capture. What did it say about the trip that another stop did not?`;
  }
  if (entry.template === 'note') {
    return `This practical note, "${label}", survived the trip. What made that detail stick?`;
  }
  return '';
}

function rankEntries(entries: StoredJournalEntry[]): StoredJournalEntry[] {
  return [...entries]
    .map((entry) => ({ entry, score: scoreEntry(entry) }))
    .sort((a, b) => b.score - a.score || b.entry.updatedAt - a.entry.updatedAt)
    .map((item) => item.entry);
}

function scoreEntry(entry: StoredJournalEntry): number {
  let score = 1;
  if (entry.favorite) score += 4;
  if (entry.template === 'interesting') score += 3;
  if (entry.template === 'moment' || entry.template === 'spark') score += 2;
  if (entry.destination.trim()) score += 1.5;
  if (entry.tags.length) score += Math.min(entry.tags.length, 3);
  if (entry.coverImage) score += 2;
  score += Math.min(entry.body.trim().length / 120, 3);
  return score;
}

function topCounts(values: string[], limit: number) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .slice(0, limit);
}

function travelerModeFor(templateId: string, tags: string[]) {
  if (templateId === 'interesting') return 'Curious Observer';
  if (templateId === 'note') return 'Sharp-Eyed Planner';
  if (templateId === 'place') return 'Place Collector';
  if (templateId === 'spark') return 'Internal Monologue Wanderer';
  if (tags.includes('food') || tags.includes('cafe')) return 'Taste-First Rover';
  return 'Feeling-First Wanderer';
}

function recapLineFor(place: string, travelerMode: string, tags: string[]) {
  if (tags.length) {
    return `${place} anchored the route, but ${tags.slice(0, 2).map((tag) => `#${tag}`).join(' and ')} were the real through-lines of this ${travelerMode.toLowerCase()} run.`;
  }
  return `${place} may be the postcard answer, but the recap is really about how a ${travelerMode.toLowerCase()} trip kept turning practical notes into memory.`;
}

function titleForTrip(place: string, travelerMode: string) {
  if (!place || place === 'the trip') return `${travelerMode} Summer`;
  return `${place}, but make it ${travelerMode}`;
}

function summaryFromEntries(entries: StoredJournalEntry[]) {
  const snippets = entries
    .slice(0, 3)
    .map((entry) => `"${excerpt(entry.body, 68)}"`)
    .join(' ');
  return snippets || 'A handful of small details ended up carrying more weight than the bigger landmarks.';
}

function scopeLabelFor(legs: StoredLeg[], entries: StoredJournalEntry[]) {
  const from = legs[0]?.dateFrom ?? entries[0]?.happenedOn;
  const to = legs[legs.length - 1]?.dateTo ?? entries[entries.length - 1]?.happenedOn;
  if (!from || !to) return 'Whole trip';
  return `${from} → ${to}`;
}

function dedupeIds(ids: string[]) {
  return [...new Set(ids.filter(Boolean))];
}
