/** Shared labels and state locations for the DOM benchmark reports. */
export const statePlacements = [
  { id: 'module', title: 'Module state', dataOwned: false, selectionOwned: false },
  { id: 'owner', title: 'Component state', dataOwned: true, selectionOwned: true },
  { id: 'module-data', title: 'Mixed state: module data, component selection', dataOwned: false, selectionOwned: true },
  { id: 'module-selection', title: 'Mixed state: component data, module selection', dataOwned: true, selectionOwned: false },
] as const;
export const updateStyles = ['mutable', 'immutable'] as const;
export const rowStyles = ['component', 'inline'] as const;
export type StatePlacement = typeof statePlacements[number];
export type UpdateStyle = typeof updateStyles[number];
export type RowStyle = typeof rowStyles[number];
