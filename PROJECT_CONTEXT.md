We are building a full-stack project called INTERN SCOUT AI.

You are my technical project partner. Continue from the exact current state described below.

IMPORTANT RULES:
1. Do not randomly change the tech stack or architecture.
2. Do not skip steps.
3. Before giving code, check the CURRENT PROJECT STATE below.
4. Do not assume a file/folder/database table exists unless listed below.
5. Explain exactly WHERE to create/edit every file because I am building manually in VS Code.
6. Give one manageable step at a time unless I specifically ask for multiple steps.
7. After each major step, update the PROJECT STATE so I can save it.
8. If something previously recommended is incorrect or outdated, explicitly correct it instead of silently changing direction.
9. Do not expose secret API keys in frontend code.
10. We are building a real portfolio-quality project, not just a UI demo.

==================================================
PROJECT NAME
==================================================

InternScout AI

An intelligent internship discovery platform.

The application should discover CURRENT tech internship openings from the web based on filters selected by the user.

The user should be able to find internships based on:

- Role
- Skills
- Graduation year
- Experience
- Location
- Remote / Hybrid / Onsite preference
- Posted within X days
- Paid/unpaid
- Minimum stipend
- Internship duration

The system will use Firecrawl for web discovery and scraping.

IMPORTANT:
We are NOT literally scraping the entire internet.

The architecture should be:

User Filters
    ↓
Query Generation Engine
    ↓
Firecrawl Search
    ↓
Relevant Job URL Collection
    ↓
URL Filtering
    ↓
Firecrawl Scraping
    ↓
Structured Internship Extraction
    ↓
Eligibility Checking
    ↓
Duplicate Detection
    ↓
Match Scoring
    ↓
Supabase Database
    ↓
Internship Results Dashboard

==================================================
CORE FEATURES
==================================================

PHASE 1 — MVP

1. Authentication
2. User internship filters
3. Firecrawl internship discovery
4. Smart search query generation
5. Scrape actual job pages
6. Extract structured internship information
7. Store internships in Supabase
8. Eligibility checker
9. Personalized match score
10. Duplicate detection
11. Internship cards
12. Direct application links
13. Save/bookmark internships

PHASE 2

14. AI natural language search

Example:
"I am a 2028 CSE student from India. I know React, Node.js and Python. Find remote internships posted this week with no experience requirement."

The system should convert this into structured filters.

15. Freshness verification

Show:
Posted 2 days ago
Verified 3 hours ago

Closed or expired jobs should eventually be marked inactive.

16. Application tracker

Saved
→ Applied
→ Assessment
→ Interview
→ Offer
→ Rejected

17. Search history

18. Internship alerts/notifications

==================================================
TECH STACK
==================================================

Frontend:
Next.js
TypeScript
Tailwind CSS

Current project uses App Router.

IMPORTANT:
This project DOES NOT have a src folder.

The project structure currently starts like this:

internscout-ai/
│
├── app/
├── lib/
├── public/
├── .env.local
├── package.json
├── tsconfig.json
└── other Next.js config files

Backend:
Initially Next.js API routes / server-side code.

Database:
Supabase PostgreSQL

Authentication:
Supabase Auth

Web Search + Scraping:
Firecrawl API

Deployment later:
Vercel + Supabase

==================================================
CURRENT PROJECT STATUS
==================================================

The Next.js project has already been created.

The development server works.

The project is opened in VS Code.

There is NO src directory.

Therefore all paths must use:

app/
lib/

NOT:

src/app/
src/lib/

==================================================
SUPABASE SETUP
==================================================

A Supabase project already exists.

The environment variables have been configured in:

.env.local

The environment variables are:

NEXT_PUBLIC_SUPABASE_URL=

NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=

The project URL and publishable key are already configured.

Never ask me to expose or paste secret keys into the frontend.

==================================================
SUPABASE CLIENT FILES
==================================================

Current intended structure:

lib/
└── supabase/
    ├── client.ts
    └── server.ts

client.ts contains the browser Supabase client.

The intended code is:

import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  );
}

server.ts was also created for server-side Supabase access using @supabase/ssr and next/headers.

==================================================
DATABASE TABLES ALREADY CREATED
==================================================

The following tables already exist:

1. profiles

Columns:

id
full_name
graduation_year
experience_years
created_at


2. user_preferences

Columns include:

id
user_id
preferred_roles
skills
preferred_locations
work_modes
min_stipend
paid_only
posted_within_days
created_at


3. internships

Columns include:

id
company
role
description
location
work_mode
posted_date
deadline
duration
stipend
experience_required
graduation_requirements
required_skills
application_url
source_url
source_domain
status
last_verified_at
created_at


4. saved_internships

Columns include:

id
user_id
internship_id
application_status
notes
created_at


application_status values are:

saved
applied
assessment
interview
offer
rejected

==================================================
DATABASE SECURITY
==================================================

RLS is enabled on:

profiles
user_preferences
saved_internships
internships

For internships, the SQL verification showed:

internships | rowsecurity = true

There is already a policy:

"Anyone can view active internships"

Policy logic:

SELECT is allowed when:

status = 'active'

Normal frontend users should NOT directly insert, update, or delete internships.

Internship ingestion from Firecrawl must later happen securely on the server/backend.

Never expose the Supabase service role key to the browser.

==================================================
CURRENT UI STATE
==================================================

The current homepage is:

app/page.tsx

It has already been replaced from the default Next.js page.

The current page is a dark InternScout AI landing/search page.

It currently includes:

Navbar:
- InternScout AI title
- Sign In button

Hero:
"Find internships that actually match you."

Search filters:

1. Role
   Options:
   - Software Engineering
   - Frontend Development
   - Backend Development
   - Full Stack Development
   - AI/ML
   - Data Science

2. Location
   Free text input

3. Work Mode
   - Remote
   - Hybrid
   - Onsite

4. Graduation Year
   - 2027
   - 2028
   - 2029
   - 2030

5. Posted Within
   - Last 24 hours
   - Last 3 days
   - Last 7 days
   - Last 30 days

The "Search Internships" button currently only logs the selected filters.

Firecrawl is NOT connected yet.

The database is NOT yet being queried from the UI.

Authentication is NOT yet implemented.

==================================================
NEXT DEVELOPMENT ROADMAP
==================================================

We should proceed in this order.

STEP 1 — Finish the search UI foundation

Improve the existing search page without overengineering it.

Potential additions:

- Skills input
- Experience filter
- Paid only toggle
- Minimum stipend
- Better validation
- Loading state

Do not completely redesign everything unnecessarily.

--------------------------------------------------

STEP 2 — Create TypeScript types

Create a central type definition for:

Internship
SearchFilters
SearchResult
EligibilityResult

Suggested location:

types/

or another simple root-level location appropriate for this project.

--------------------------------------------------

STEP 3 — Design the search request architecture

When the user clicks:

Search Internships

The frontend should send filters to a secure server-side endpoint.

Suggested architecture:

Frontend
↓
POST /api/search

The API route validates the filters.

Do NOT call Firecrawl directly from the browser.

The Firecrawl API key must remain server-side only.

--------------------------------------------------

STEP 4 — Add Firecrawl environment variable

Later add:

FIRECRAWL_API_KEY=

This must NOT have NEXT_PUBLIC_ in front of it.

--------------------------------------------------

STEP 5 — Build smart query generation

The backend should convert filters into multiple search queries.

Example user filters:

Role: AI/ML
Graduation year: 2028
Experience: 0
Work mode: Remote
Posted within: 7 days

Possible generated searches:

"AI ML Intern" remote student

"Machine Learning Intern" remote fresher

"AI Engineer Intern" remote student

site:jobs.lever.co "Machine Learning Intern"

site:boards.greenhouse.io "Software Engineer Intern"

The exact queries should be intelligently generated based on selected roles and filters.

Do not rely on only one query.

--------------------------------------------------

STEP 6 — Firecrawl Search

Use Firecrawl Search to discover relevant URLs.

The search stage should find:

- Official company careers pages
- Startup careers pages
- Job boards
- Internship platforms
- Relevant direct application pages

Prioritize official company application URLs where possible.

--------------------------------------------------

STEP 7 — Filter discovered URLs

Before scraping, reject obvious irrelevant results such as:

- Articles about internships
- Internship advice blogs
- Courses
- Training programs pretending to be internships
- Old news posts
- Duplicate URLs
- Obviously full-time jobs

--------------------------------------------------

STEP 8 — Scrape relevant job pages

Use Firecrawl to scrape selected job pages.

Extract structured internship information:

company
role
description
location
work_mode
posted_date
deadline
duration
stipend
experience_required
graduation_requirements
required_skills
application_url
source_url
source_domain

--------------------------------------------------

STEP 9 — Eligibility engine

Compare user information with internship requirements.

Example:

User:
Graduation year: 2028
Experience: 0
Skills:
React
Node.js
Python

Output:

Eligible
Possibly Eligible
Not Eligible

Also provide an explanation.

Example:

"Likely eligible because the role accepts current students, does not require previous professional experience, and does not exclude the user's graduation year."

Do not claim eligibility with certainty when the job posting is ambiguous.

--------------------------------------------------

STEP 10 — Match scoring

Create a transparent scoring system.

Example factors:

Role match
Skills match
Graduation year compatibility
Experience compatibility
Location preference
Work mode preference
Freshness

The score should return 0–100.

Example display:

96% Match

Also show:

Why this match?

Example:

✓ Role matches preference
✓ Remote preference matches
✓ 4/5 skills matched
✓ No experience required
✓ Posted 2 days ago

--------------------------------------------------

STEP 11 — Duplicate detection

The same internship may appear on:

Company website
LinkedIn
Internshala
Indeed
Other sources

Do not show duplicates.

Prefer:

1. Official company application page
2. Official ATS page
3. Reputable job board

Potential duplicate fields:

company
role
location
application URL
normalized role title

--------------------------------------------------

STEP 12 — Save internships to Supabase

Only verified/processed internships should be stored.

Before inserting:

Check for duplicates.

Internship writes must happen securely from server-side code.

--------------------------------------------------

STEP 13 — Display real results

Replace the current console.log behavior with actual search results.

Show:

Company
Role
Location
Work mode
Posted date
Stipend
Match score
Eligibility status

Buttons:

View Details
Apply
Save

--------------------------------------------------

STEP 14 — Saved internships

Connect the existing:

saved_internships

table.

Users should be able to:

Save
Unsave
Change application status
Add notes

--------------------------------------------------

STEP 15 — Authentication

Add Supabase Auth.

Possible options:

Email/password
Google login

After login:

Create/manage profile.

Eventually save:

Graduation year
Experience
Skills
Preferences

--------------------------------------------------

STEP 16 — Freshness verification

Later implement periodic verification.

For every stored internship:

last_verified_at

Check whether the listing is still available.

If closed:

status = closed

If expired:

status = expired

Normal users should only see:

status = active

--------------------------------------------------

STEP 17 — AI natural language search

After the core filter-based system works.

Example input:

"I am a 2028 CSE student from India. I know React, Node.js and Python. Find remote internships posted this week with no experience."

Convert to:

{
  roles: [],
  skills: [],
  graduationYear: 2028,
  experience: 0,
  location: "India",
  workMode: "remote",
  postedWithinDays: 7
}

Then run the normal search pipeline.

==================================================
IMPORTANT ARCHITECTURAL PRINCIPLES
==================================================

1. Firecrawl API key must NEVER be exposed to the frontend.

2. Supabase service role key must NEVER be exposed to the frontend.

3. Search first, scrape selectively afterward to reduce unnecessary API usage.

4. Do not blindly trust scraped data.

5. Eligibility should be:
   - Eligible
   - Possibly Eligible
   - Not Eligible

when information is ambiguous.

6. Prioritize current job postings based on the user's selected time window.

7. Prefer official application links.

8. Do not scrape hundreds of pages unnecessarily.

9. Use server-side API routes for Firecrawl operations.

10. Build the MVP first before adding AI features and background workers.

==================================================
CURRENT EXACT POSITION
==================================================

We have completed:

✓ Next.js project setup
✓ Supabase project setup
✓ Environment variables
✓ Supabase browser client
✓ Supabase server client
✓ Database tables
✓ RLS setup
✓ Internship read policy
✓ Basic homepage
✓ Basic internship search filters

WE ARE CURRENTLY AT:

Improving/finalizing the search UI and then creating the TypeScript types and secure API architecture before connecting Firecrawl.

Do not restart the project.

Continue from this point.
Read this project context. We are continuing InternScout AI. Follow the roadmap and tell me exactly what the next step is.