export class DecisionTree {
  childrenLeft: number[];
  childrenRight: number[];
  threshold: number[];
  feature: number[];
  value: number[][];

  constructor(m: {
    children_left: number[];
    children_right: number[];
    threshold: number[];
    feature: number[];
    value: number[][];
  }) {
    this.childrenLeft = m.children_left;
    this.childrenRight = m.children_right;
    this.threshold = m.threshold.map(Number);
    this.feature = m.feature;
    this.value = m.value.map((row) => row.map(Number));
  }

  predictProba(x: number[]): number[] {
    let node = 0;
    while (this.feature[node] !== -2) {
      node = x[this.feature[node]] <= this.threshold[node]
        ? this.childrenLeft[node]
        : this.childrenRight[node];
    }
    const v = this.value[node];
    const s = v.reduce((a, b) => a + b, 0);
    return v.map((e) => e / s);
  }
}

export class ForestModel {
  trees: DecisionTree[];
  classes: number[];

  constructor(trees: DecisionTree[], classes: number[]) {
    this.trees = trees;
    this.classes = classes;
  }

  static fromJson(json: {
    dtrees: Record<string, unknown>[];
    classes: number[];
  }): ForestModel {
    return new ForestModel(
      json.dtrees.map((t) => new DecisionTree(t as ConstructorParameters<typeof DecisionTree>[0])),
      json.classes,
    );
  }

  predictProba(x: number[]): number[] {
    const acc = new Array<number>(this.classes.length).fill(0);
    for (const tree of this.trees) {
      const p = tree.predictProba(x);
      for (let i = 0; i < acc.length; i++) acc[i] += p[i];
    }
    return acc.map((v) => v / this.trees.length);
  }

  scorePositive(x: number[]): number {
    return this.predictProba(x)[1];
  }

  /** Per-tree P(flight) for ensemble disagreement / confidence. */
  treePositiveProbabilities(x: number[]): number[] {
    return this.trees.map((tree) => tree.predictProba(x)[1]);
  }

  scorePositiveWithConfidence(x: number[]): {
    prob: number;
    variance: number;
    stdDev: number;
    confidence: ConfidenceLevel;
  } {
    const treeProbs = this.treePositiveProbabilities(x);
    const prob = treeProbs.reduce((a, b) => a + b, 0) / treeProbs.length;
    const variance =
      treeProbs.reduce((acc, p) => acc + (p - prob) ** 2, 0) / treeProbs.length;
    const stdDev = Math.sqrt(variance);
    return { prob, variance, stdDev, confidence: confidenceFromStdDev(stdDev) };
  }
}

export type ConfidenceLevel = 'Low' | 'Medium' | 'High';

export function confidenceFromStdDev(stdDev: number): ConfidenceLevel {
  if (stdDev < 0.08) return 'High';
  if (stdDev < 0.15) return 'Medium';
  return 'Low';
}

let dailyModel: ForestModel | null = null;
let hourlyModel: ForestModel | null = null;
let loading: Promise<void> | null = null;

export async function ensureModelsLoaded(): Promise<void> {
  if (dailyModel && hourlyModel) return;
  if (!loading) {
    loading = (async () => {
      const [dailyRes, hourlyRes] = await Promise.all([
        fetch('/models/final_model.json'),
        fetch('/models/hour_model.json'),
      ]);
      dailyModel = ForestModel.fromJson(await dailyRes.json());
      hourlyModel = ForestModel.fromJson(await hourlyRes.json());
    })();
  }
  await loading;
}

export function getDailyModel(): ForestModel {
  if (!dailyModel) throw new Error('Models not loaded');
  return dailyModel;
}

export function getHourlyModel(): ForestModel {
  if (!hourlyModel) throw new Error('Models not loaded');
  return hourlyModel;
}
