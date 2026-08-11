"""The Dispatch crew: three agents running a fetch, edit and publish relay."""

from __future__ import annotations

from crewai import Agent, Crew, LLM, Process, Task
from crewai.project import CrewBase, agent, crew, task

from crew.settings import settings
from crew.tools import (
    news_fetcher_tool,
    sheets_logger_tool,
    slack_bot_tool,
    summarizer_tool,
)


def build_llm() -> LLM:
    """Groq through LiteLLM. Low temperature keeps the desk factual."""
    return LLM(
        model=f"groq/{settings.groq_model}",
        api_key=settings.groq_api_key,
        temperature=0.2,
    )


@CrewBase
class NewsroomCrew:
    """Multi-agent newsroom that publishes a briefing without a human trigger."""

    agents_config = "config/agents.yaml"
    tasks_config = "config/tasks.yaml"

    @agent
    def scout(self) -> Agent:
        return Agent(
            config=self.agents_config["scout"],
            tools=[news_fetcher_tool],
            llm=build_llm(),
            verbose=True,
        )

    @agent
    def editor(self) -> Agent:
        return Agent(
            config=self.agents_config["editor"],
            tools=[summarizer_tool],
            llm=build_llm(),
            verbose=True,
        )

    @agent
    def distributor(self) -> Agent:
        return Agent(
            config=self.agents_config["distributor"],
            tools=[slack_bot_tool, sheets_logger_tool],
            llm=build_llm(),
            verbose=True,
        )

    @task
    def gather(self) -> Task:
        return Task(config=self.tasks_config["gather"])

    @task
    def edit(self) -> Task:
        return Task(config=self.tasks_config["edit"])

    @task
    def distribute(self) -> Task:
        return Task(config=self.tasks_config["distribute"])

    @crew
    def crew(self) -> Crew:
        return Crew(
            agents=self.agents,
            tasks=self.tasks,
            process=Process.sequential,
            # Chroma-backed memory is unnecessary here: every run starts from a
            # clean slate and de-duplication happens inside the editor task.
            memory=False,
            verbose=True,
        )
