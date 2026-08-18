/**
 * fitment-v1/pipeline — R1 integrert kandidat-/evidens-pipeline.
 * Identity → applikasjoner (flere mulig) → kandidater → OE → feature-profil → skiller → status.
 * Bevarer proveniens på hver kant. Heuristisk evidens kan snevre inn, aldri alene gi AUTHORITATIVE EXACT.
 */
import { EvidenceKernel } from './policy/kernel.js';
import { ApplicationResolver, type VehicleFacts } from './application-resolver.js';
import { buildEvidenceRequests, isIrrelevantQuestion, type EvidenceRequest } from './differentiation.js';
import type { Candidate, FitmentResult } from './domain.js';

export interface R1PipelineResult {
  registrationNumber: string;
  vehicleFacts: VehicleFacts;
  applications: ReturnType<ApplicationResolver['resolve']>;
  kernel: FitmentResult;
  candidates: Candidate[];
  evidenceRequests: EvidenceRequest[];
  irrelevantQuestionCount: number;
  vehicleToOeGap: boolean;
}

export class R1Pipeline {
  constructor(
    private readonly kernel: EvidenceKernel,
    private readonly appResolver: ApplicationResolver,
  ) {}

  run(v: VehicleFacts & { registrationNumber: string }): R1PipelineResult {
    const applications = this.appResolver.resolve(v);
    const kernel = this.kernel.resolve({
      registrationNumber: v.registrationNumber,
      vin: v.vinFacts?.vin ?? null,
      make: v.make,
      model: v.model,
      modelYear: v.modelYear,
      firstRegistrationDate: v.firstRegistration ?? null,
    });
    const requests = buildEvidenceRequests(kernel.candidates);
    const irrelevant = requests.filter((q) => isIrrelevantQuestion(q, kernel.candidates)).length;
    return {
      registrationNumber: v.registrationNumber,
      vehicleFacts: v,
      applications,
      kernel,
      candidates: kernel.candidates,
      evidenceRequests: requests,
      irrelevantQuestionCount: irrelevant,
      vehicleToOeGap: !kernel.reasonCodes.some((r) => r.includes('OE_EDGE') || r === 'EXACT'),
    };
  }
}
