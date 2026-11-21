// The catalogue's website tool, shared by the page and the action bridge, so both give
// the agent the same name, rules and input.
import { MODELS, PART_KINDS, VARIANTS } from "./catalogue.js";

export const LOOKUP_TOOL = {
  name: "lookup_part",
  description: "Find the exact Vayu part number for a vehicle and a part. Returns the part number, name, genuine or compatible, the vehicles it fits and any compatible alternatives, or what is missing, such as the brake variant. It does not check stock: dealers do that.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["model", "year", "part"],
    properties: {
      model: { type: "string", enum: MODELS, description: "The vehicle model." },
      year: { type: "integer", minimum: 1990, maximum: 2030, description: "The model year." },
      variant: { type: "string", enum: VARIANTS, description: "The variant, if the visitor gave it." },
      part: { type: "string", enum: PART_KINDS, description: "The kind of part." },
    },
  },
};
