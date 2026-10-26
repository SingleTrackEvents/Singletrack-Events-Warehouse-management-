import { describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { alive, create } from '../db/repo';
import type { Destination } from '../db/types';
import { moveUnit, unitPlaces } from './units';

async function station(eventId: string, name: string, units: string[]): Promise<Destination> {
  return create(db.destinations, {
    eventId, name, type: 'aid_station', courseKm: null, access: '2wd', accessNotes: '', lat: null, lng: null,
    crewLead: '', phone: '', openTime: '', closeTime: '', notes: '', sort: 10,
    schedule: { windows: [], departsAt: null, setup: '', packDown: '', power: '', connectivity: '', units },
  });
}

describe('individual units', () => {
  it('says where each unit is, in number order', async () => {
    const rosea = await station('e', 'Rosea', ['Starlink 3', 'EcoFlow #2']);
    await station('e', 'Borough Huts', ['Starlink 10']);
    const places = unitPlaces(alive(await db.destinations.toArray()));
    expect(places.map((place) => place.unit)).toEqual(['EcoFlow #2', 'Starlink 3', 'Starlink 10']);
    expect(places[1].at.map((entry) => entry.id)).toEqual([rosea.id]);
  });

  it('moves a unit so it is only ever in one place', async () => {
    const rosea = await station('e', 'Rosea', ['Starlink 3']);
    const cassidys = await station('e', 'Cassidys Gap Rd', []);
    await moveUnit('e', 'starlink 3', cassidys.id);
    expect((await db.destinations.get(rosea.id))!.schedule!.units).toEqual([]);
    expect((await db.destinations.get(cassidys.id))!.schedule!.units).toEqual(['Starlink 3']);
  });
});
