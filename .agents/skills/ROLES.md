# Skill map cho đội phát triển phần mềm (subagents)
Mỗi agent/subagent: đọc .agents/skills/<skill>/SKILL.md của các skill theo vai trò trước khi làm việc.
Khi chạy trong sandbox Notion AI còn có thêm: /skills/artifact-design, /skills/data-analysis, /skills/pptx, /skills/sheets, /skills/inline-charts.

| Vai trò | Skill chính | Skill phụ |
|---|---|---|
| Orchestrator (PM điều phối) | dispatching-parallel-agents, subagent-driven-development, writing-plans | verification-before-completion |
| Product Manager | grill-me, brainstorming, to-spec, to-tickets | grill-with-docs, doc-coauthoring |
| Business Analyst | domain-modeling, grill-with-docs, research | to-spec |
| UX/UI Designer | ui-ux-pro-max, frontend-design, taste-skill, design-system | web-design-guidelines, prototype, /skills/artifact-design |
| Solution Architect | codebase-design, improve-codebase-architecture, domain-modeling | supabase-postgres-best-practices, mcp-builder, research |
| Frontend Developer | react-best-practices, composition-patterns, frontend-design, tdd | react-native-skills (mobile), implement |
| Backend Developer | tdd, implement, supabase-postgres-best-practices | mcp-builder, codebase-design |
| QA / Tester | webapp-testing, tdd, systematic-debugging, diagnosing-bugs | verification-before-completion, web-design-guidelines |
| Code Reviewer | code-review, requesting-code-review | react-best-practices, web-design-guidelines |
| DevOps | deploy-to-vercel | verification-before-completion |
| Tech Writer | doc-coauthoring, writing-guidelines | domain-modeling (glossary/ADR) |

Nguồn: skills.sh (mattpocock/skills, obra/superpowers, anthropics/skills, vercel-labs/agent-skills, supabase/agent-skills, nextlevelbuilder/ui-ux-pro-max-skill, leonxlnx/taste-skill).
