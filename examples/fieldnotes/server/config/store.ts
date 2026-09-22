export interface Note {
  id: string;
  text: string;
  by: string;
}

export interface Expedition {
  id: string;
  name: string;
  region: string;
  days: number;
  notes: Note[];
}

export interface Store {
  readonly expeditions: Expedition[];
}

export function createStore(): Store {
  return {
    expeditions: [
      {
        id: 'ice-cores',
        name: 'Ice Core Survey',
        region: 'Antarctica',
        days: 42,
        notes: [
          { id: 'n1', text: 'Drill site reached — cores looking clean.', by: 'team' },
          { id: 'n2', text: 'Storm window tomorrow, pack down early.', by: 'team' },
        ],
      },
      {
        id: 'canopy',
        name: 'Canopy Transect',
        region: 'Amazon Basin',
        days: 18,
        notes: [
          { id: 'n3', text: 'Three new orchid sightings on line 4.', by: 'team' },
        ],
      },
      {
        id: 'meteorites',
        name: 'Meteorite Traverse',
        region: 'Sahara',
        days: 9,
        notes: [],
      },
    ],
  };
}
