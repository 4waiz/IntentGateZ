# IBM Z Datathon 2026: verified competition requirements

Compiled on 17 Oct 2026 (UAE time) from the sources listed at the bottom. Anything not found in a source is marked **unverified**. Nothing here is invented.

## Event facts

| Item | Verified value | Source |
|---|---|---|
| Event | IBM Z Datathon 2026, organised by Shooting Stars Foundation (SSF), powered by IBM | [H2S] |
| Format | Global 24-hour hybrid datathon, college students only | [H2S], [GB] |
| Team size | 4 to 6 members (mandatory) | [H2S], [GB] |
| Infrastructure | One LinuxONE Community Cloud server per team, event code `SSF2026` | [ORG], [GB] |
| Dubai hub | 17 Oct 2026, 9 AM to 3 PM, MPH, Symbiosis International University Dubai | [ORG] |
| Official start | 17 Oct 2026, 10:00 AM UAE | [SCHED] |
| Dubai submission deadline | 18 Oct 2026, 10:00 AM UAE (organiser message); the hub schedule image says 10:30 AM | [ORG], [SCHED] |
| Hack2Skill "Project Submissions" window | 17 Oct 2026 03:45 AM +04 to 18 Oct 2026 08:30 PM +04 | [H2S] |
| Regional virtual deadline (APAC/EMEA/Americas tables) | Oct 18, 10:00 AM local time | [GB] |
| Results | 28 Oct 2026 | [GB], [SCHED] |

**Operating deadline for this team: 18 Oct 2026, 10:00 AM UAE** (the earliest of the conflicting published times).

## Themes (official names)

1. Real-Time AI for Critical Decisions (Detect. Decide. Respond.)
2. **AI Secured: Innovation Without Exposure (Powerful AI. Protected Data.)**, the theme chosen for IntentGate Z. The guidebook lists "Identity & Access", "Cybersecurity" and "Secure AI" as example problem areas under it.
3. Wildcard: Beyond the Obvious

Teams may submit one project per challenge track [GB Q13]. There is no "Secure & Privacy-Preserving AI" track name; theme 2 is the matching official track.

## Required submission contents

From the guidebook section "Datathon Guidelines (FOR THE FINAL SUBMISSION ON OCTOBER 17 - 18)" [GB]:

- [ ] **Video, no more than 3 minutes**, covering: the problem statement, data to support the problem, the solution, and *most importantly* how the solution leverages IBM Z (tech stack, show the LinuxONE instance and model). Compulsory.
- [ ] **Code**: GitHub link, zip upload, "whatever works". Do not forget the GitHub/GitLab repo link.
- [ ] **Project title must contain the team name**, format: `[Team Name_IBM Z Datathon 2026 Project]`.
- [ ] **Links to open-source resources used** must be added to the submission (Rule 5).
- Optional: flowchart of the design; prototype.

The Hack2Skill FAQ also lists: working demo or prototype, source code repository link, short project description, presentation/pitch deck [H2S FAQ].

Submission is made on Hack2Skill (https://hack2skill.com/event/datathon-2026), "Abstract submission section" per the H2S FAQ. A how-to video is linked in the guidebook: https://youtu.be/3_L3T__zEco. **The live form fields are unverified until the authenticated portal is inspected.**

## Judging rubric (4 x 10 points = 40)

From [GB] "Judging Evaluation Criteria and Standardized Scoring Rubric":

1. **Value to the Community & Datathon Theme Alignment**: real-world problem, who benefits, theme reflected in idea and execution.
2. **Novelty & Idea Originality**: new ideas, built entirely during the Datathon, code created from scratch in the event timeframe.
3. **Technical Design & Use of Mainframe/LinuxONE Community Cloud platform and AI/ML open-source packages**:
   - strength of technical architecture;
   - AI/ML running on LinuxONE;
   - **both provided AI/ML labs are mandatory prerequisites before building**: (1) Predictive AI hybrid AI scenarios (multi-model), (2) Predictive AI + Generative AI;
   - use of platform capabilities (containerisation, security, scalability, compute) **shown with screenshots as evidence**.
4. **Execution & Delivery / Pitch Quality**: clarity, professionalism, compelling pitch, solution demo included, staying within the video time limit.

AI Innovation Excellence Awards add a 20-point rubric (AI innovation & originality; transformational impact & technical excellence) for eligible high scorers.

## Rules that constrain the build

- No continuation hacks; the project must start within the hacking period [GB Rules 1, H2S FAQ]. This repository had no commits before 17 Oct 2026, 11:50 AM UAE.
- Project must be original; no taking code from other participants or outside [GB Rule 4]. Open-source libraries and IBM-provided tools are allowed with links in the submission [GB Rule 5].
- Datasets must be legally used and properly licensed [H2S FAQ].

## LinuxONE environment facts

From the webinar transcript and guidebook links [WEB], [GB]:

- Virtual server for the datathon: 3 vCPUs, 8 GB RAM, 50 GB disk, 30-day lifetime.
- Choose the `-datathon` images (`Ubuntu 24.04-datathon` or `RHEL 9.8-datathon`) and the AI lab flavor, which only appears when the account was registered with event code `SSF2026`.
- Username `linux1`; SSH key pair created or imported in the dashboard; full sudo.
- Machine type 9175 = IBM z17; `lscpu` shows the `nnpa` facility (Telum II on-chip AI accelerator).
- Official ML container and labs: https://github.com/linuxone-community-cloud/jupyter-lab-ml.
- Jupyter must use a private token, never the default, because VMs have public IPs.

## Status of access (updated as work progresses)

| Access | Status |
|---|---|
| GitHub (`4waiz`, repo `4waiz/IntentGateZ`) | Authenticated via `gh`, repo exists, public, empty at start |
| LinuxONE dashboard | Sign-in page reachable; requires the team's credentials |
| Hack2Skill portal | Public pages readable; submission area requires the team's sign-in |
| Claude in Chrome | Not connected during this session; built-in browser used instead |

## Sources

- [H2S] Hack2Skill event page: https://hack2skill.com/event/datathon-2026 (read 17 Oct 2026)
- [GB] Participant guidebook: https://docs.google.com/document/d/1tt0ZhUyirXDtHIEum3JhG-ZIj6y-YpUc5e15mPT78w4 (plain-text export read 17 Oct 2026)
- [ORG] Dubai organiser announcement (provided by the team)
- [SCHED] Dubai hub schedule image "Schedule - 17th October 2026" (provided by the team)
- [WEB] "Get Your LinuxONE Ready" technical enablement session transcript: https://www.youtube.com/live/HrNNkVyFots
