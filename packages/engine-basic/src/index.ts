import { AgentContext, AgentEngine, AgentResult } from "@amp/engine-spi";

export class BasicEngine implements AgentEngine {
  id = "engine.basic";
  capabilities(): string[] { return ["chat", "auto-approve"]; }

  async runTurn(ctx: AgentContext): Promise<AgentResult> {
    ctx.logger.event("model.called", { input: ctx.input.text });
    const reply = await ctx.model.chat(ctx.input.text);
    return {
      messages: [{ role: "assistant", content: reply }]
    };
  }
}
