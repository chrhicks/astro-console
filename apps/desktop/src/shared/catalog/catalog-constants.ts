import { SolarSystemTarget } from "./catalog-schema";

export const SOLAR_SYSTEM_TARGETS: SolarSystemTarget[] = [
  { id: 'sun',   designation: 'Sun',   body: 'sun',     viewMode: 'sun',   recommendedFilter: 'ir',    source: 'solar-system' },
  { id: 'moon',  designation: 'Moon',  body: 'moon',    viewMode: 'moon',  recommendedFilter: 'clear', source: 'solar-system' },
  { id: 'planet:mercury', designation: 'Mercury', body: 'mercury', viewMode: 'planet', recommendedFilter: 'clear', source: 'solar-system' },
  { id: 'planet:venus',   designation: 'Venus',   body: 'venus',   viewMode: 'planet', recommendedFilter: 'clear', source: 'solar-system' },
  { id: 'planet:mars',    designation: 'Mars',    body: 'mars',    viewMode: 'planet', recommendedFilter: 'clear', source: 'solar-system' },
  { id: 'planet:jupiter', designation: 'Jupiter', body: 'jupiter', viewMode: 'planet', recommendedFilter: 'clear', source: 'solar-system' },
  { id: 'planet:saturn',  designation: 'Saturn',  body: 'saturn',  viewMode: 'planet', recommendedFilter: 'clear', source: 'solar-system' },
  { id: 'planet:uranus',  designation: 'Uranus',  body: 'uranus',  viewMode: 'star',   recommendedFilter: 'clear', source: 'solar-system' },
  { id: 'planet:neptune', designation: 'Neptune', body: 'neptune', viewMode: 'star',   recommendedFilter: 'clear', source: 'solar-system' },
]