import {
	Action,
	ActionPanel,
	Icon,
	List,
	Toast,
	environment,
	getPreferenceValues,
	openExtensionPreferences,
	showToast,
} from "@raycast/api";
import { useEffect, useState } from "react";

import { SNAPSHOT } from "./generated/provider-catalog";
import {
	clearDebugEvents,
	clearTranslationCache,
	getDebugEvents,
	type DebugEvent,
} from "./lib/index";
import { markdownText } from "./presentation";
import { RAYCAST_EXTENSION_VERSION } from "./version";

interface DebugPreferences {
	debugMode?: boolean;
}

interface DiagnosticsState {
	error?: string;
	events: readonly DebugEvent[];
	loading: boolean;
}

export default function TranslationDiagnosticsCommand() {
	const { debugMode = false } = getPreferenceValues<DebugPreferences>();
	const [requestVersion, setRequestVersion] = useState(0);
	const [state, setState] = useState<DiagnosticsState>({ events: [], loading: true });

	useEffect(() => {
		let active = true;
		setState((current) => ({ ...current, error: undefined, loading: true }));
		void getDebugEvents().then(
			(events) => {
				if (active) {
					setState({ events: [...events].reverse(), loading: false });
				}
			},
			(error: unknown) => {
				if (active) {
					setState({
						error: error instanceof Error ? error.message : "Could not read diagnostic events.",
						events: [],
						loading: false,
					});
				}
			},
		);
		return () => {
			active = false;
		};
	}, [requestVersion]);

	const sharedActions = (
		<ActionPanel>
			<Action
				title="Refresh Diagnostics"
				icon={Icon.RotateClockwise}
				onAction={() => setRequestVersion((version) => version + 1)}
			/>
			<Action
				title="Clear Diagnostic Events"
				icon={Icon.Trash}
				style={Action.Style.Destructive}
				onAction={async () => {
					await clearDebugEvents();
					setState({ events: [], loading: false });
					await showToast({ style: Toast.Style.Success, title: "Diagnostic events cleared" });
				}}
			/>
			<Action
				title="Clear Translation Cache"
				icon={Icon.Trash}
				onAction={async () => {
					clearTranslationCache();
					await showToast({ style: Toast.Style.Success, title: "Translation cache cleared" });
				}}
			/>
			<Action
				title="Open Extension Preferences"
				icon={Icon.Gear}
				onAction={openExtensionPreferences}
			/>
		</ActionPanel>
	);

	return (
		<List isLoading={state.loading} isShowingDetail searchBarPlaceholder="Filter diagnostic events">
			{state.events.length === 0 ? (
				<List.EmptyView
					actions={sharedActions}
					icon={state.error ? Icon.Warning : Icon.MagnifyingGlass}
					title={state.error ?? "No Diagnostic Events"}
					description={emptyDiagnosticsDescription(debugMode)}
				/>
			) : (
				state.events.map((event) => (
					<List.Item
						id={event.id}
						key={event.id}
						title={event.eventType}
						subtitle={[event.provider, event.modelId, event.status].filter(Boolean).join(" • ")}
						keywords={diagnosticKeywords(event)}
						accessories={[
							...(event.httpStatus === undefined ? [] : [{ text: String(event.httpStatus) }]),
							{ text: eventTime(event.timestamp) },
						]}
						detail={
							<List.Item.Detail
								markdown={diagnosticMarkdown(event, debugMode)}
								metadata={
									<List.Item.Detail.Metadata>
										<List.Item.Detail.Metadata.Label
											title="Extension"
											text={RAYCAST_EXTENSION_VERSION}
										/>
										<List.Item.Detail.Metadata.Label
											title="Raycast"
											text={environment.raycastVersion}
										/>
										<List.Item.Detail.Metadata.Label
											title="Snapshot"
											text={SNAPSHOT.commit.slice(0, 12)}
										/>
										<List.Item.Detail.Metadata.Label
											title="Debug Mode"
											text={debugMode ? "Enabled" : "Disabled"}
										/>
									</List.Item.Detail.Metadata>
								}
							/>
						}
						actions={sharedActions}
					/>
				))
			)}
		</List>
	);
}

function diagnosticMarkdown(event: DebugEvent, debugMode: boolean): string {
	return `# Sanitized Request Event\n\n${markdownText(JSON.stringify(event, null, 2))}\n\n---\n\nDebug recording is ${debugMode ? "enabled" : "disabled"}. Text, translations, API keys, headers, bodies, and raw provider errors are never stored.`;
}

function diagnosticKeywords(event: DebugEvent): string[] {
	return [event.eventType, event.provider, event.modelId, event.status, event.errorCode].filter(
		(value): value is string => Boolean(value),
	);
}

function eventTime(timestamp: string): string {
	const date = new Date(timestamp);
	return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleTimeString();
}

function emptyDiagnosticsDescription(debugMode: boolean): string {
	const nextStep = debugMode
		? "Run a translation request, then refresh this view."
		: "Enable Debug Mode in extension preferences, then run a translation request.";
	return `${nextStep} Extension ${RAYCAST_EXTENSION_VERSION}; Raycast ${environment.raycastVersion}; snapshot ${SNAPSHOT.commit.slice(0, 12)}.`;
}
