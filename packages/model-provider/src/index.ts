import { ModelProvider } from "@amp/engine-spi";

export class EchoModel implements ModelProvider {
  id(): string { return "model.echo"; }
  async chat(prompt: string): Promise<string> {
    return `ECHO: ${prompt}`;
  }
}
