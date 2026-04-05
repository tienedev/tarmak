export class Schema {
  constructor(
    public entity: string,
    public fields: string[],
    public version = 1,
  ) {}

  encode(): string {
    return `#${this.entity}@v${this.version}:${this.fields.join(",")}`;
  }

  static parse(line: string): Schema | null {
    const trimmed = line.trim();
    if (!trimmed.startsWith("#")) return null;

    const rest = trimmed.slice(1);
    const atPos = rest.indexOf("@");
    if (atPos === -1) return null;

    const entity = rest.slice(0, atPos);
    if (!entity) return null;

    const afterAt = rest.slice(atPos + 1);
    if (!afterAt.startsWith("v")) return null;

    const colonPos = afterAt.indexOf(":");
    if (colonPos === -1) return null;

    const version = Number.parseInt(afterAt.slice(1, colonPos), 10);
    if (Number.isNaN(version)) return null;

    const fieldsStr = afterAt.slice(colonPos + 1);
    if (!fieldsStr) return null;

    const fields = fieldsStr.split(",");
    return new Schema(entity, fields, version);
  }

  fieldIndex(name: string): number {
    return this.fields.indexOf(name);
  }

  addField(name: string): void {
    this.fields.push(name);
    this.version += 1;
  }
}
