/** Shared deterministic make/model cleanup. Never infer generation or equipment.
 * This only removes an *identical leading make token*, such as
 * "TOYOTA TOYOTA RAV4" or "MITSUBISHI MITSUBISHI OUTLANDER".
 * Preserve Golf Plus/Sportsvan, e-Golf, XC40/C40, 500 Electric etc.
 */
export interface CanonicalVehicleName { make: string; model: string; changed: boolean }

const MAKE_ALIASES: Record<string,string> = {
  VOLKSWAGEN: 'VW', VAG: 'VW',
  'MERCEDES-BENZ': 'MERCEDES', MB: 'MERCEDES', 'M-B': 'MERCEDES',
};

export function canonicalVehicleName(make: string, model: string): CanonicalVehicleName {
  const originalMake=make.trim().toUpperCase().replace(/\s+/g,' ');
  const originalModel=model.trim().toUpperCase().replace(/\s+/g,' ');
  const canonicalMake=MAKE_ALIASES[originalMake]??originalMake;
  let canonicalModel=originalModel;
  const leading=[originalMake, canonicalMake];
  if(canonicalMake==='VW')leading.push('VOLKSWAGEN');
  if(canonicalMake==='MERCEDES')leading.push('MERCEDES-BENZ');
  // Remove repeated manufacturer at start only, preserving a standalone
  // manufacturer-as-model such as MINI. Never remove internal model tokens.
  const unique=[...new Set(leading.filter(Boolean))].sort((a,b)=>b.length-a.length);
  for(let step=0;step<2;step++){
    let stripped=false;
    for(const prefix of unique){
      const rest=canonicalModel.startsWith(prefix+' ')?canonicalModel.slice(prefix.length+1):null;
      if(rest && rest!==canonicalMake){canonicalModel=rest;stripped=true;break;}
    }
    if(!stripped)break;
  }
  return {
    make:canonicalMake, model:canonicalModel,
    changed:canonicalMake!==originalMake||canonicalModel!==originalModel
  };
}
