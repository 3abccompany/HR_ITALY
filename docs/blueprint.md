# **App Name**: HR Nexus Studio

## Core Features:

- User Authentication & Access Control: Secure user login, logout, and registration flow with Firebase Auth. Implement membership-based permission checks and redirects for Super Admins, multi-entity users, and users without access. Uses getCurrentUserContext to load user data and memberships.
- Multi-Tenant (Entity) Management & Selection: Allows Super Admins to manage entities, and presents users with multiple entity options via the '/select-entity' route based on their active memberships. Routes users with single memberships directly to their dashboard.
- Super Admin Overview Dashboard: A dedicated placeholder dashboard for Super Admins to oversee platform-level data like entities, users, roles, permissions, and memberships, serving as the entry point for system administration.
- Core Personnel Record Management: Foundation for creating, retrieving, and uniquely identifying person records ('persons/{personId}') within specific entities, acting as the stable root identity across different employment stages.
- Candidate Lifecycle Tracking: Enables the creation of new candidate records, tracks their status changes, and manages the attachment of interviews. Ensures `person.currentLifecycleStatus` and `person.currentCandidateId` are updated.
- Interview Workflow & Decision System: Facilitates scheduling of interviews for candidates, records interview details, scores, and decisions, and updates the candidate's status and linked interview IDs accordingly.
- Seamless Candidate-to-Employee Conversion Tool: Implements the critical transactional logic using Firestore runTransaction to convert a candidate to an employee. This tool creates the employee record, updates candidate/person statuses, sets historical links (`sourceCandidateId`, `sourceInterviewId`), generates a person timeline event, and records an audit log.

## Style Guidelines:

- Primary Color: Deep indigo (`#1F1F66`). A rich, professional hue conveying stability and depth, setting a refined tone for the 'Studio app' concept. This contrasts effectively with a light background for strong readability.
- Background Color: Light bluish-grey (`#EEEFF7`). A desaturated shade of the primary hue, providing a clean, spacious backdrop that maintains visual harmony and promotes readability in a data-centric application.
- Accent Color: Vibrant sky blue (`#4DB3E6`). An analogous color providing a clear, engaging contrast to the primary. Its brightness and saturation make it ideal for calls-to-action, highlights, and interactive elements, ensuring visual cues are easily distinguishable.
- Headline Font: 'Space Grotesk' (sans-serif) for a modern, slightly tech-informed and distinctive feel. Body Font: 'Inter' (sans-serif) for high legibility, clean lines, and an objective, neutral aesthetic suitable for extensive data display and forms in an enterprise environment.
- Minimalist, line-based icons that align with a professional 'studio app' aesthetic. Focus on clarity and immediate recognition for actions and data categories within personnel management.
- A structured and organized layout for optimal content visibility and ease of navigation. Dashboards should feature clear divisions between components, prioritizing responsive design for adaptability across various screen sizes typical of an enterprise application.
- Subtle and functional animations for user feedback, such as on form submissions, loading states, and state transitions (e.g., successful login or entity selection). Animations should enhance usability without distracting from core tasks, adhering to a professional tone.