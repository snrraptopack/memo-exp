/** Stable facade for effect discovery and emission phases. */
export { scanEffects } from './effects/discovery';
export {
  buildEffectRegistrations,
  buildLocalEffectInvalidations,
  rejectUnownedEffects,
  rewriteModuleEffects,
} from './effects/emission';
