import type { Dict } from "./en";
import { en } from "./en";
import { es } from "./es";
import { pt } from "./pt";
import { fr } from "./fr";
import { it } from "./it";
import { de } from "./de";
import type { Lang } from "./langs";

/** Every dictionary, keyed by language code. Each is typed `Dict`, so it must
 * carry exactly the English key set (missing/extra keys are compile errors). */
export const dictionaries: Record<Lang, Dict> = { en, es, pt, fr, it, de };
