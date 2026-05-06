'use server';
/**
 * @fileOverview This file implements a Genkit flow for extracting key skills, work experience, and education from a candidate's resume or text description.
 *
 * - generateCandidateProfile - A function that handles the candidate profile generation process.
 * - GenerateCandidateProfileInput - The input type for the generateCandidateProfile function.
 * - GenerateCandidateProfileOutput - The return type for the generateCandidateProfile function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const GenerateCandidateProfileInputSchema = z
  .object({
    resumeDataUri: z
      .string()
      .optional()
      .describe(
        "A resume document, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
      ),
    description: z
      .string()
      .optional()
      .describe('A brief text description of the candidate or their resume.'),
  })
  .refine(
    data => data.resumeDataUri || data.description,
    'Either resumeDataUri or description must be provided.'
  );

export type GenerateCandidateProfileInput = z.infer<
  typeof GenerateCandidateProfileInputSchema
>;

const GenerateCandidateProfileOutputSchema = z.object({
  skills: z
    .array(z.string())
    .describe('A list of key skills extracted from the resume/description.'),
  workExperience: z
    .array(
      z.object({
        company: z.string().describe('The name of the company.'),
        title: z.string().describe('The job title.'),
        duration: z.string().describe('The duration of employment (e.g., "Jan 2020 - Dec 2022").'),
        description: z
          .string()
          .optional()
          .describe('A brief description of responsibilities and achievements.'),
      })
    )
    .describe('A list of work experiences.'),
  education: z
    .array(
      z.object({
        institution: z.string().describe('The name of the educational institution.'),
        degree: z.string().describe('The degree obtained.'),
        fieldOfStudy: z.string().optional().describe('The field of study.'),
        graduationDate: z
          .string()
          .optional()
          .describe('The graduation date (e.g., "May 2022").'),
      })
    )
    .describe('A list of educational background.'),
});

export type GenerateCandidateProfileOutput = z.infer<
  typeof GenerateCandidateProfileOutputSchema
>;

export async function generateCandidateProfile(
  input: GenerateCandidateProfileInput
): Promise<GenerateCandidateProfileOutput> {
  return generateCandidateProfileFlow(input);
}

const prompt = ai.definePrompt({
  name: 'generateCandidateProfilePrompt',
  input: {schema: GenerateCandidateProfileInputSchema},
  output: {schema: GenerateCandidateProfileOutputSchema},
  prompt: `You are an expert HR assistant tasked with extracting key information from candidate profiles.
Based on the provided information, extract the candidate's key skills, work experience, and education.
If a resume is provided, prioritize information from the resume.

Input:
{{#if resumeDataUri}}
Resume: {{media url=resumeDataUri}}
{{else if description}}
Description: {{{description}}}
{{/if}}

Extract the following:
- Skills: A list of key skills.
- Work Experience: For each entry, include the company name, job title, duration (e.g., "Jan 2020 - Dec 2022"), and a brief description of responsibilities/achievements.
- Education: For each entry, include the institution, degree obtained, field of study, and graduation date (e.g., "May 2022").`,
});

const generateCandidateProfileFlow = ai.defineFlow(
  {
    name: 'generateCandidateProfileFlow',
    inputSchema: GenerateCandidateProfileInputSchema,
    outputSchema: GenerateCandidateProfileOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    if (!output) {
      throw new Error('Failed to generate candidate profile from prompt.');
    }
    return output;
  }
);
