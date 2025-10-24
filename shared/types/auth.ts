import { z } from 'zod'

/* Schema */
export const emailFormSchema = z.object({
  email: z.email('Please enter a valid email address'),
  otp: z.string().optional(),
})

export const userFormSchema = z.object({
  name: z.string().min(2, 'Please enter your full name'),
  dob: z.string().nonempty('Please provide date of birth'),
  gender: z.enum(['male', 'female', 'other']),
  phone: z
    .string()
    .min(7, 'Enter valid phone number')
    .regex(/^\+?\d{7,15}$/, 'Invalid phone number'),
})
