import { z } from "zod";

export const uuidSchema = z.uuid();
export const nonEmptyStringSchema = z.string().trim().min(1);
