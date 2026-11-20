"""The Dispatch crew: three agents running a fetch, edit and publish relay."""

from __future__ import annotations

from crewai import Agent, Crew, LLM, Process, Task
from crewai.project import CrewBase, agent, crew, task

from crew.settings import is_reasoning_model, settings
from crew.tools import (
    news_fetcher_tool,
    sheets_logger_tool,
    slack_bot_tool,
    summarizer_tool,
)


def build_llm() -> LLM:
    """Groq through CrewAI's native OpenAI provider.

    Groq is not one of CrewAI's native providers, so a "groq/" model string
    falls through to LiteLLM. That path does not strip the cache_breakpoint
    marker CrewAI attaches to system messages, and Groq rejects the request
    outright with an invalid_request_error. Groq's OpenAI-compatible endpoint
    takes the native provider instead, which strips the marker correctly.

    Low temperature keeps the desk factual. The agents only route work, so a
    gpt-oss agent model is asked for low reasoning effort.
    """
    extra = {"reasoning_effort": "low"} if is_reasoning_model(settings.crew_agent_model) else {}
    return LLM(
        model=f"openai/{settings.crew_agent_model}",
        base_url="https://api.groq.com/openai/v1",
        api_key=settings.groq_api_key,
        temperature=0.2,
        **extra,
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
