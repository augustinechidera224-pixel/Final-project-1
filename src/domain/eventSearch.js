// Pure functions: events in, events out. No store, no side effects.
// That makes them trivial to test and reuse (the API and the UI can share them).

import { mergeSort } from './sorting.js';
import { DomainError } from './errors.js';

// A summary is what the event list shows: the event plus numbers from its tiers.
export function summarizeEvent(event, tiers) {
  return {
    id: event.id,
    title: event.title,
    city: event.city,
    venue: event.venue,
    startsAt: event.startsAt,
    status: event.status,
    tierCount: tiers.length,
    minPriceCents: tiers.length ? Math.min(...tiers.map((t) => t.priceCents)) : null,
    seatsLeft: tiers.reduce((total, t) => total + (t.capacity - t.sold), 0),
  };
}

function parseDate(value, field, { endOfDay = false } = {}) {
  const match = typeof value === 'string'
    ? /^(\d{4}-\d{2}-\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.exec(value)
    : null;
  if (!match) throw new DomainError('VALIDATION', `${field} must be an ISO date`);

  const datePart = new Date(`${match[1]}T00:00:00.000Z`);
  if (
    Number.isNaN(datePart.getTime())
    || datePart.toISOString().slice(0, 10) !== match[1]
  ) {
    throw new DomainError('VALIDATION', `${field} must be a real date`);
  }

  const time = new Date(value).getTime();
  if (Number.isNaN(time)) throw new DomainError('VALIDATION', `${field} must be a valid date`);
  const isDateOnly = value.length === 10;
  if (endOfDay && isDateOnly) {
    return time + 24 * 60 * 60 * 1000 - 1;
  }
  return time;
}

function requireSummaries(summaries) {
  if (!Array.isArray(summaries)) {
    throw new DomainError('VALIDATION', 'summaries must be an array');
  }
}

function requireCriteria(criteria) {
  if (criteria === null || typeof criteria !== 'object' || Array.isArray(criteria)) {
    throw new DomainError('VALIDATION', 'criteria must be an object');
  }
}

export function filterEvents(summaries, criteria = {}) {
  requireSummaries(summaries);
  requireCriteria(criteria);
  const { q, city, from, to, maxPriceCents, onlyAvailable } = criteria;

  if (q !== undefined && typeof q !== 'string') {
    throw new DomainError('VALIDATION', 'q must be a string');
  }
  if (city !== undefined && typeof city !== 'string') {
    throw new DomainError('VALIDATION', 'city must be a string');
  }
  if (onlyAvailable !== undefined && typeof onlyAvailable !== 'boolean') {
    throw new DomainError('VALIDATION', 'onlyAvailable must be a boolean');
  }

  const text = q?.trim().toLowerCase();
  const wantedCity = city?.trim().toLowerCase();
  const fromTime = from === undefined ? undefined : parseDate(from, 'from');
  const toTime = to === undefined ? undefined : parseDate(to, 'to', { endOfDay: true });

  if (maxPriceCents !== undefined && (!Number.isSafeInteger(maxPriceCents) || maxPriceCents < 0)) {
    throw new DomainError('VALIDATION', 'maxPriceCents must be a whole number of cents');
  }

  return summaries.filter((event) => {
    if (event === null || typeof event !== 'object' || Array.isArray(event)) {
      throw new DomainError('VALIDATION', 'Each summary must be an object');
    }
    if (
      typeof event.title !== 'string'
      || typeof event.venue !== 'string'
      || typeof event.city !== 'string'
    ) {
      throw new DomainError('VALIDATION', 'Each summary must have a title, venue and city');
    }
    if (text && !`${event.title} ${event.venue}`.toLowerCase().includes(text)) return false;
    if (wantedCity && event.city.toLowerCase() !== wantedCity) return false;

    const startsAt = parseDate(event.startsAt, 'startsAt');
    if (fromTime !== undefined && startsAt < fromTime) return false;
    if (toTime !== undefined && startsAt > toTime) return false;

    if (maxPriceCents !== undefined) {
      if (event.minPriceCents !== null && event.minPriceCents !== undefined) {
        if (!Number.isSafeInteger(event.minPriceCents) || event.minPriceCents < 0) {
          throw new DomainError('VALIDATION', 'summary prices must be whole cents');
        }
        if (event.minPriceCents > maxPriceCents) return false;
      } else {
        return false;
      }
    }
    if (onlyAvailable) {
      if (!Number.isSafeInteger(event.seatsLeft) || event.seatsLeft < 0) {
        throw new DomainError('VALIDATION', 'summary seatsLeft must be a non-negative whole number');
      }
      if (event.seatsLeft === 0) return false;
    }
    return true;
  });
}

const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Tie-breaker so the order is always the same, even when the main keys are equal.
const byTitleThenId = (a, b) =>
  compareText(a.title.toLowerCase(), b.title.toLowerCase()) || compareText(a.id, b.id);

const SORTERS = {
  date: (a, b) => parseDate(a.startsAt, 'startsAt') - parseDate(b.startsAt, 'startsAt') || byTitleThenId(a, b),
  // Events with no tiers have no price: put them last.
  price: (a, b) => {
    const priceA = a.minPriceCents ?? Infinity;
    const priceB = b.minPriceCents ?? Infinity;
    return (priceA === priceB ? 0 : priceA < priceB ? -1 : 1) || byTitleThenId(a, b);
  },
  // Most seats left first.
  availability: (a, b) => b.seatsLeft - a.seatsLeft || byTitleThenId(a, b),
};

export const SORT_OPTIONS = Object.keys(SORTERS);

export function sortEvents(summaries, sortBy = 'date') {
  requireSummaries(summaries);
  if (!Object.hasOwn(SORTERS, sortBy)) {
    throw new DomainError('VALIDATION', `sort must be one of: ${SORT_OPTIONS.join(', ')}`);
  }
  return mergeSort(summaries, SORTERS[sortBy]);
}

export function searchEvents(summaries, criteria = {}, sortBy = 'date') {
  return sortEvents(filterEvents(summaries, criteria), sortBy);
}
