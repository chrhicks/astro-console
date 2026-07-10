import { SolarSystemTarget } from "./catalog-schema";

export const SOLAR_SYSTEM_TARGETS: SolarSystemTarget[] = [
  { id: 'sun',   designation: 'Sun',   body: 'sun',     targetType: 'sun',   recommendedFilter: 'ir',    source: 'solar-system' },
  { id: 'moon',  designation: 'Moon',  body: 'moon',    targetType: 'moon',  recommendedFilter: 'clear', source: 'solar-system' },
  { id: 'planet:mercury', designation: 'Mercury', body: 'mercury', targetType: 'planet', recommendedFilter: 'clear', source: 'solar-system' },
  { id: 'planet:venus',   designation: 'Venus',   body: 'venus',   targetType: 'planet', recommendedFilter: 'clear', source: 'solar-system' },
  { id: 'planet:mars',    designation: 'Mars',    body: 'mars',    targetType: 'planet', recommendedFilter: 'clear', source: 'solar-system' },
  { id: 'planet:jupiter', designation: 'Jupiter', body: 'jupiter', targetType: 'planet', recommendedFilter: 'clear', source: 'solar-system' },
  { id: 'planet:saturn',  designation: 'Saturn',  body: 'saturn',  targetType: 'planet', recommendedFilter: 'clear', source: 'solar-system' },
  { id: 'planet:uranus',  designation: 'Uranus',  body: 'uranus',  targetType: 'planet', recommendedFilter: 'clear', source: 'solar-system' },
  { id: 'planet:neptune', designation: 'Neptune', body: 'neptune', targetType: 'planet', recommendedFilter: 'clear', source: 'solar-system' },
]