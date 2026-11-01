import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  createStore,
  createEvent,
  addTier,
  publishEvent,
  bookTickets,
  listEventSummaries,
} from '../src/domain/inventory.js';
import { filterEvents, sortEvents, searchEvents } from '../src/domain/eventSearch.js';
import { DomainError } from '../src/domain/errors.js';

const titles = (events) => events.map((e) => e.title);
const throwsCode = (fn, code) =>
  assert.throws(fn, (error) => error instanceof DomainError && error.code === code);

describe('event search', () => {
  let summaries;

  before(() => {
    const store = createStore();
    const make = (title, city, startsAt, tiers, { publish = true } = {}) => {
      const event = createEvent(store, { title, city, venue: `${city} Hall`, startsAt, organizerId: 'org' });
      const created = tiers.map((t) => addTier(store, event.id, t));
      if (publish) publishEvent(store, event.id);
      return { event, created };
    };

    make('Jazz Night', 'Lagos', '2026-12-10T19:00:00Z', [{ name: 'GA', priceCents: 3000, capacity: 50 }]);
    make('Tech Summit', 'Abuja', '2026-12-05T09:00:00Z', [
      { name: 'GA', priceCents: 10000, capacity: 100 },
      { name: 'VIP', priceCents: 25000, capacity: 10 },
    ]);
    make('Food Fair', 'Lagos', '2026-12-05T12:00:00Z', [{ name: 'Entry', priceCents: 0, capacity: 500 }]);
    const sold = make('Sold Out Gig', 'Ibadan', '2026-12-20T20:00:00Z', [
      { name: 'GA', priceCents: 5000, capacity: 2 },
    ]);
    bookTickets(store, sold.created[0].id, 'u1', 2);
    make('Secret Draft', 'Lagos', '2026-12-01T10:00:00Z', [{ name: 'GA', priceCents: 100, capacity: 5 }], {
      publish: false,
    });

    summaries = listEventSummaries(store);
  });

  it('hides drafts from the public list', () => {
    assert.equal(summaries.length, 4);
    assert.ok(!titles(summaries).includes('Secret Draft'));
  });

  it('summarises price and seats across tiers', () => {
    const summit = summaries.find((e) => e.title === 'Tech Summit');
    assert.equal(summit.minPriceCents, 10000);
    assert.equal(summit.seatsLeft, 110);
  });

  describe('filtering', () => {
    it('by city, ignoring case', () => {
      assert.deepEqual(titles(filterEvents(summaries, { city: 'lagos' })).sort(), ['Food Fair', 'Jazz Night']);
    });

    it('by text in the title or venue', () => {
      assert.deepEqual(titles(filterEvents(summaries, { q: 'JAZZ' })), ['Jazz Night']);
      assert.deepEqual(titles(filterEvents(summaries, { q: 'summit' })), ['Tech Summit']);
      assert.deepEqual(titles(filterEvents(summaries, { q: 'ibadan hall' })), ['Sold Out Gig']);
    });

    it('by maximum price, including free events', () => {
      assert.deepEqual(titles(filterEvents(summaries, { maxPriceCents: 3000 })).sort(), ['Food Fair', 'Jazz Night']);
      assert.deepEqual(titles(filterEvents(summaries, { maxPriceCents: 0 })), ['Food Fair']);
      const noTier = { ...summaries[0], title: 'No Tier', minPriceCents: null };
      assert.equal(filterEvents([...summaries, noTier], { maxPriceCents: 3000 }).includes(noTier), false);
    });

    it('by date range, where a date-only "to" includes the whole day', () => {
      const result = filterEvents(summaries, { from: '2026-12-05', to: '2026-12-05' });
      assert.deepEqual(titles(result).sort(), ['Food Fair', 'Tech Summit']);
      const eventAtFive = {
        ...summaries[0],
        title: 'Five PM Event',
        startsAt: '2026-12-05T17:00:00Z',
      };
      assert.equal(
        titles(filterEvents([...summaries, eventAtFive], { to: '2026-12-05' })).includes('Five PM Event'),
        true,
      );
      assert.deepEqual(
        titles(filterEvents(summaries, { from: '2026-12-10T19:00:00Z' })),
        ['Jazz Night', 'Sold Out Gig'],
      );
    });

    it('can hide sold-out events', () => {
      assert.ok(!titles(filterEvents(summaries, { onlyAvailable: true })).includes('Sold Out Gig'));
    });

    it('rejects nonsense input', () => {
      throwsCode(() => filterEvents(summaries, { from: 'yesterday-ish' }), 'VALIDATION');
      throwsCode(() => filterEvents(summaries, { from: '2026-02-30' }), 'VALIDATION');
      throwsCode(() => filterEvents(summaries, { maxPriceCents: 1.5 }), 'VALIDATION');
      throwsCode(() => filterEvents(summaries, { maxPriceCents: -5 }), 'VALIDATION');
      throwsCode(() => filterEvents(summaries, null), 'VALIDATION');
      throwsCode(() => filterEvents(summaries, { q: 5 }), 'VALIDATION');
    });
  });

  describe('sorting', () => {
    it('by date (default), earliest first', () => {
      assert.deepEqual(titles(sortEvents(summaries)), ['Tech Summit', 'Food Fair', 'Jazz Night', 'Sold Out Gig']);
    });

    it('by price, cheapest first', () => {
      assert.deepEqual(titles(sortEvents(summaries, 'price')), ['Food Fair', 'Jazz Night', 'Sold Out Gig', 'Tech Summit']);
    });

    it('by availability, most seats first', () => {
      assert.deepEqual(titles(sortEvents(summaries, 'availability')), [
        'Food Fair',
        'Tech Summit',
        'Jazz Night',
        'Sold Out Gig',
      ]);
    });

    it('does not change the input and rejects unknown sort keys', () => {
      const before = structuredClone(summaries);
      sortEvents(summaries, 'price');
      assert.deepEqual(summaries, before);
      throwsCode(() => sortEvents(summaries, 'constructor'), 'VALIDATION');
    });

    it('breaks equal sort keys by title then id', () => {
      const events = [
        { id: 'b', title: 'Bravo', startsAt: '2026-12-05T12:00:00Z', minPriceCents: 10, seatsLeft: 2 },
        { id: 'z', title: 'Alpha', startsAt: '2026-12-05T12:00:00Z', minPriceCents: 10, seatsLeft: 2 },
        { id: 'a', title: 'Alpha', startsAt: '2026-12-05T12:00:00Z', minPriceCents: 10, seatsLeft: 2 },
      ];
      assert.deepEqual(sortEvents(events).map((event) => event.id), ['a', 'z', 'b']);
    });

    it('returns a new stable result for empty lists and equivalent sort keys', () => {
      const empty = [];
      assert.deepEqual(sortEvents(empty), []);
      assert.notEqual(sortEvents(empty), empty);
      assert.deepEqual(filterEvents(empty), []);
      assert.deepEqual(searchEvents(empty), []);

      const equalKeyEvents = [
        { id: 'same', title: 'Same', startsAt: '2026-12-05T12:00:00Z', minPriceCents: 10, seatsLeft: 1, order: 1 },
        { id: 'same', title: 'Same', startsAt: '2026-12-05T12:00:00Z', minPriceCents: 10, seatsLeft: 1, order: 2 },
      ];
      assert.deepEqual(sortEvents(equalKeyEvents).map((event) => event.order), [1, 2]);
    });

    it('orders equivalent instants chronologically when ISO offsets differ', () => {
      const events = [
        { id: 'later', title: 'Later', startsAt: '2026-12-05T14:00:00+02:00', minPriceCents: 10, seatsLeft: 1 },
        { id: 'earlier', title: 'Earlier', startsAt: '2026-12-05T11:00:00Z', minPriceCents: 10, seatsLeft: 1 },
      ];
      assert.deepEqual(sortEvents(events).map((event) => event.id), ['earlier', 'later']);
    });
  });

  it('searchEvents filters then sorts', () => {
    const result = searchEvents(summaries, { city: 'Lagos' }, 'price');
    assert.deepEqual(titles(result), ['Food Fair', 'Jazz Night']);
  });

  it('filtering returns a new list without changing the original', () => {
    const input = structuredClone(summaries);
    const snapshot = structuredClone(input);
    const filtered = filterEvents(input, { city: 'lagos' });
    assert.deepEqual(input, snapshot);
    assert.notEqual(filtered, input);
  });
});
