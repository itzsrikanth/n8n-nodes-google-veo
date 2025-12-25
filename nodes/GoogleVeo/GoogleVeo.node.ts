import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';
import { GoogleGenAI } from "@google/genai";

declare const setTimeout: (callback: () => void, ms: number) => void;
declare const Buffer: {
	from(data: string, encoding: 'base64'): Buffer;
	from(data: ArrayBuffer): Buffer;
};
interface Buffer {
	length: number;
}

export class GoogleVeo implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'GoogleVeo',
		name: 'googleveo',
		icon: { light: 'file:googleveo.svg', dark: 'file:googleveo.dark.svg' },
		group: ['transform'],
		version: 1,
		description: 'Generate videos using Google Veo3',
		defaults: {
			name: 'GoogleVeo',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'geminiApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Prompt',
				name: 'prompt',
				type: 'string',
				typeOptions: {
					rows: 4,
				},
				default: '',
				required: true,
				placeholder: 'A golden retriever playing in autumn leaves, cinematic lighting',
				description: 'Describe the video you want to generate',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		// Get credentials properly using getCredentials()
		const credentials = await this.getCredentials('geminiApi');
		const ai = new GoogleGenAI({
			apiKey: credentials.apiKey as string,
		});

		for (let i = 0; i < items.length; i++) {
			const prompt = this.getNodeParameter('prompt', i) as string;

			let task = await ai.models.generateVideos({
				model: 'veo-3.1-generate-preview',
				prompt: prompt,
			});

			while (!task.done) {
				await new Promise<void>(resolve => setTimeout(resolve, 10000));
				task = await ai.operations.getVideosOperation({
					operation: task,
				});
			}

			const responseJson = JSON.parse(JSON.stringify(task.response ?? {}));
			const videoFile = task.response?.generatedVideos?.[0]?.video;

			if (videoFile) {
				let binaryData;

				if (videoFile.videoBytes) {
					// Video bytes are base64 encoded - decode them
					const videoBuffer = Buffer.from(videoFile.videoBytes, 'base64');
					binaryData = await this.helpers.prepareBinaryData(
						videoBuffer,
						'video.mp4',
						videoFile.mimeType ?? 'video/mp4',
					);
				} else if (videoFile.uri) {
					// Fetch video from URI using n8n's httpRequest helper
					const videoResponse = await this.helpers.httpRequest({
						method: 'GET',
						url: videoFile.uri,
						headers: { 'x-goog-api-key': credentials.apiKey as string },
						encoding: 'arraybuffer',
					});
					binaryData = await this.helpers.prepareBinaryData(
						Buffer.from(videoResponse as ArrayBuffer),
						'video.mp4',
						videoFile.mimeType ?? 'video/mp4',
					);
				}

				if (binaryData) {
					returnData.push({
						json: responseJson,
						binary: { video: binaryData },
					});
				} else {
					returnData.push({ json: responseJson });
				}
			} else {
				returnData.push({ json: responseJson });
			}
		}

		return [returnData];
	}
}
