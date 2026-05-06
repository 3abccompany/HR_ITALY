'use server';
/**
 * @fileOverview A Genkit flow for generating a welcome email and a personalized onboarding task list for a new employee.
 * 
 * - generateOnboardingPlan - A function that handles the generation process.
 * - GenerateOnboardingPlanInput - The input type for the generateOnboardingPlan function.
 * - GenerateOnboardingPlanOutput - The return type for the generateOnboardingPlan function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

// Input Schema
const GenerateOnboardingPlanInputSchema = z.object({
  employeeId: z.string().describe('The ID of the new employee.'),
  personId: z.string().describe('The ID of the person.'),
  entityId: z.string().describe('The ID of the entity (company).'),
  firstName: z.string().describe('The first name of the new employee.'),
  lastName: z.string().describe('The last name of the new employee.'),
  email: z.string().email().describe('The email address of the new employee.'),
  hireDate: z.string().describe('The hiring date of the new employee (ISO date string).'),
  departmentName: z.string().describe('The department name the employee will join.'),
  jobRoleName: z.string().describe('The job role name of the new employee.'),
  companyName: z.string().describe('The name of the company.'),
});
export type GenerateOnboardingPlanInput = z.infer<typeof GenerateOnboardingPlanInputSchema>;

// Output Schema
const GenerateOnboardingPlanOutputSchema = z.object({
  welcomeEmail: z.object({
    subject: z.string().describe('The subject line of the welcome email.'),
    body: z.string().describe('The body content of the welcome email.'),
  }).describe('A draft welcome email for the new employee.'),
  onboardingTaskList: z.array(z.object({
    task: z.string().describe('A concise title for the onboarding task.'),
    description: z.string().describe('A detailed description of the onboarding task.'),
  })).describe('A personalized list of initial onboarding tasks for the new employee.'),
});
export type GenerateOnboardingPlanOutput = z.infer<typeof GenerateOnboardingPlanOutputSchema>;

// Wrapper function
export async function generateOnboardingPlan(input: GenerateOnboardingPlanInput): Promise<GenerateOnboardingPlanOutput> {
  return generateOnboardingPlanFlow(input);
}

// Genkit Prompt Definition
const generateOnboardingPlanPrompt = ai.definePrompt({
  name: 'generateOnboardingPlanPrompt',
  input: { schema: GenerateOnboardingPlanInputSchema },
  output: { schema: GenerateOnboardingPlanOutputSchema },
  prompt: `You are an HR assistant tasked with generating a welcome email and a personalized onboarding task list for a new employee.\n\nEmployee Details:\n- First Name: {{{firstName}}}\n- Last Name: {{{lastName}}}\n- Email: {{{email}}}\n- Hire Date: {{{hireDate}}}\n- Department: {{{departmentName}}}\n- Job Role: {{{jobRoleName}}}\n- Company Name: {{{companyName}}}\n\nPlease generate:\n1.  A warm and professional welcome email draft for the new employee. The email should congratulate them, mention their role and department, and express enthusiasm for them joining the team.\n2.  A personalized initial onboarding task list (around 5-7 tasks) tailored to their job role and department. Tasks should cover initial setup, introductions, training, and getting started in their role. Each task should have a clear title and a brief description.\n\nEnsure the output adheres strictly to the following JSON format.\n`,
});

// Genkit Flow Definition
const generateOnboardingPlanFlow = ai.defineFlow(
  {
    name: 'generateOnboardingPlanFlow',
    inputSchema: GenerateOnboardingPlanInputSchema,
    outputSchema: GenerateOnboardingPlanOutputSchema,
  },
  async (input) => {
    const { output } = await generateOnboardingPlanPrompt(input);
    if (!output) {
      throw new Error("Failed to generate onboarding plan: output was null or undefined.");
    }
    return output;
  }
);
