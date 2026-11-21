// The Vayu parts catalogue: which part number fits which vehicle. The page, the website
// tool and the action bridge all use lookupPart.
import catalogue from "../catalogue.json" with { type: "json" };

export const MODELS = catalogue.models.map((model) => model.name);
export const VARIANTS = [...new Set(catalogue.models.flatMap((model) => model.variants))];
export const PART_KINDS = [...new Set(catalogue.parts.map((part) => part.kind))];

/**
 * Find the parts that fit a vehicle.
 *
 * :param request: {model, year, variant?, part}, where part is a kind such as "clutch cable".
 * :return: {ok: true, vehicle, parts: [{partNo, name, type, fits, alternatives}]}, or
 *   {ok: false, reason}, with needs and choices when the variant is needed first.
 */
export function lookupPart({ model, year, variant, part }) {
  const entry = catalogue.models.find((candidate) => candidate.name === model);
  if (!entry) {
    return { ok: false, reason: `This catalogue lists ${MODELS.join(", ")}.` };
  }
  const [from, to] = entry.years;
  if (!Number.isInteger(year) || year < from || year > to) {
    return { ok: false, reason: `The ${model} was made from ${from} to ${to}.` };
  }
  if (variant !== undefined && !entry.variants.includes(variant)) {
    return { ok: false, reason: `The ${model} comes as ${entry.variants.join(" or ")}.` };
  }
  const fitting = catalogue.parts.filter((candidate) => candidate.kind === part && candidate.fits.some((fit) => fit.model === model && year >= fit.years[0] && year <= fit.years[1]));
  if (fitting.length === 0) {
    return { ok: false, reason: `No ${part} is listed for a ${year} ${model}.` };
  }
  const needsVariant = fitting.some((candidate) => candidate.fits.some((fit) => fit.model === model && fit.variant));
  if (needsVariant && variant === undefined) {
    return { ok: false, needs: "variant", choices: entry.variants, reason: `Is it the ${entry.variants.join(" or the ")} version of the ${model}?` };
  }
  const parts = fitting
    .filter((candidate) => candidate.fits.some((fit) => fit.model === model && (!fit.variant || fit.variant === variant)))
    .map((candidate) => ({
      partNo: candidate.partNo,
      name: candidate.name,
      type: candidate.type,
      fits: candidate.fits.map((fit) => `${fit.model} ${fit.years[0]}-${fit.years[1]}${fit.variant ? ` (${fit.variant})` : ""}`).join("; "),
      alternatives: candidate.alternatives,
    }));
  return { ok: true, vehicle: `${model} (${year}${variant ? `, ${variant}` : ""})`, parts };
}
