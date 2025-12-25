// Complete OpenRouter implementation as separate API option

// 1. Add API constant (around line 1049)
const API_LLAMA_CPP = 0;
const API_KOBOLD_CPP = 2;
const API_OPENAI_COMPAT = 3;
const API_AI_HORDE = 4;
const API_OPENROUTER = 5; // ADD THIS

// 2. Update normalizeEndpoint function (around line 1082)
function normalizeEndpoint(endpoint, endpointAPI) {
	const url = new URL(endpoint.trim());
	url.pathname = url.pathname.replace(/\/+/g, "/");

	let urlString = url.toString();
	if (endpointAPI == API_OPENAI_COMPAT)
		urlString = urlString.replace(/\/v1\/?$/, "");
	if (endpointAPI == API_KOBOLD_CPP)
		urlString = urlString.replace(/\/api\/?$/, "");
	if (endpointAPI == API_AI_HORDE)
		urlString = "https://aihorde.net/api";
	if (endpointAPI == API_OPENROUTER) // ADD THIS
		urlString = "https://openrouter.ai/api";
	urlString = urlString.replace(/\/$/, "");

	return urlString;
}

// 3. Add OpenRouter models function (around line 1524, after aiHordeModels)
async function openRouterModels({ endpoint, endpointAPIKey, proxyEndpoint, signal, ...options }) {
	const res = await fetch(`${proxyEndpoint ?? endpoint}/v1/models`, {
		method: 'GET',
		headers: {
			'Content-Type': 'application/json',
			...(endpointAPIKey ? (proxyEndpoint ? { 'X-Real-Authorization': `Bearer ${endpointAPIKey}` } : { 'Authorization': `Bearer ${endpointAPIKey}` }) : {}),
			...(proxyEndpoint ? { 'X-Real-URL': endpoint } : {})
		},
		signal,
	});

	if (!res.ok)
		throw new Error(`HTTP ${res.status}`);

	const response = await res.json();
	return response.data || [];
}

// 4. Update getModels function (around line 1185)
export async function getModels({ endpoint, endpointAPI, endpointAPIKey, signal, ...options }) {
	endpoint = normalizeEndpoint(endpoint, endpointAPI);
	switch (endpointAPI) {
		case API_OPENAI_COMPAT:
			return await openaiModels({ endpoint, endpointAPIKey, signal, ...options });
		case API_AI_HORDE:
			return await aiHordeModels({ endpoint, endpointAPIKey, signal, ...options });
		case API_OPENROUTER: // ADD THIS
			return await openRouterModels({ endpoint, endpointAPIKey, signal, ...options });
		default:
			return [];
	}
}

// 5. Update completion function (around line 1197)
export async function* completion({ endpoint, endpointAPI, endpointAPIKey, signal, ...options }) {
	endpoint = normalizeEndpoint(endpoint, endpointAPI);
	switch (endpointAPI) {
		case API_LLAMA_CPP:
			return yield* await llamaCppCompletion({ endpoint, endpointAPIKey, signal, ...options });
		case API_KOBOLD_CPP:
			return yield* await koboldCppCompletion({ endpoint, endpointAPIKey, signal, ...options });
		case API_OPENAI_COMPAT:
		case API_OPENROUTER: // ADD THIS
			return yield* await openaiCompletion({ endpoint, endpointAPIKey, signal, ...options });
		case API_AI_HORDE:
			return yield* await aiHordeCompletion({ endpoint, endpointAPIKey, signal, ...options });
	}
}

// 6. Update chatCompletion function (around line 1210)
export async function* chatCompletion({ endpoint, endpointAPI, endpointAPIKey, signal, ...options }) {
	endpoint = normalizeEndpoint(endpoint, endpointAPI);
	switch (endpointAPI) {
		case API_OPENAI_COMPAT:
		case API_OPENROUTER: // ADD THIS
			return yield* await openaiChatCompletion({ endpoint, endpointAPIKey, signal, ...options });
	}
}

// 7. Create OpenRouterSettingsModal (around line 1730, similar to AIHordeSettingsModal)
function OpenRouterSettingsModal({ isOpen, closeModal, endpoint, endpointAPIKey, setEndpointAPIKey, isMikupadEndpoint, sessionStorage, endpointModel, setEndpointModel, cancel }) {
	const [models, setModels] = useState([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(null);
	const [localSelected, setLocalSelected] = useState('');
	const [searchTerm, setSearchTerm] = useState('');
	const [showKey, setShowKey] = useState(false);
	const [sortBy, setSortBy] = useState('name');

	const fetchModels = async (acSignal) => {
		setLoading(true);
		setError(null);
		try {
			const openRouterEndpoint = normalizeEndpoint(endpoint, API_OPENROUTER);
			const res = await fetch(`${isMikupadEndpoint ? sessionStorage.proxyEndpoint : openRouterEndpoint}/v1/models`, {
				method: 'GET',
				headers: {
					'Content-Type': 'application/json',
					...(endpointAPIKey ? (isMikupadEndpoint ? { 'X-Real-Authorization': `Bearer ${endpointAPIKey}` } : { 'Authorization': `Bearer ${endpointAPIKey}` }) : {}),
					...(isMikupadEndpoint ? { 'X-Real-URL': openRouterEndpoint } : {})
				},
				signal: acSignal,
			});

			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			
			const response = await res.json();
			const modelData = response.data || [];
			setModels(modelData);
		} catch (e) {
			if (e.name !== 'AbortError') {
				setError(e.toString());
			}
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		if (isOpen) {
			setLocalSelected(endpointModel || '');
			const ac = new AbortController();
			fetchModels(ac.signal);
			return () => ac.abort();
		}
	}, [isOpen]);

	const handleSelect = (modelId) => {
		setLocalSelected(modelId);
	};

	const handleOk = () => {
		setEndpointModel(localSelected);
		closeModal();
	};

	const formatPrice = (price) => {
		if (!price) return 'N/A';
		return `$${(price * 1000000).toFixed(2)}/1M`;
	};

	const sortedModels = useMemo(() => {
		let sorted = [...models];
		switch (sortBy) {
			case 'context':
				sorted.sort((a, b) => (b.context_length || 0) - (a.context_length || 0));
				break;
			case 'pricing':
				sorted.sort((a, b) => {
					const priceA = a.pricing?.prompt || Infinity;
					const priceB = b.pricing?.prompt || Infinity;
					return priceA - priceB;
				});
				break;
			case 'name':
			default:
				sorted.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
				break;
		}
		return sorted;
	}, [models, sortBy]);

	const filteredModels = sortedModels.filter(model => 
		model.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
		(model.name && model.name.toLowerCase().includes(searchTerm.toLowerCase()))
	);

	return html`
		<${Modal} isOpen=${isOpen} onClose=${closeModal} title="OpenRouter Settings" style=${{width: '50em', 'max-height': '90vh'}}>
			<div className="vbox" style=${{gap: '1em'}}>
				<div>OpenRouter provides access to various AI models through a unified API.
					<a href="https://openrouter.ai/docs" target="_blank" rel="noopener noreferrer" style=${{marginLeft: '8px'}}>Documentation</a>
				</div>

				<div className="hbox-flex" style=${{"flex-wrap": "unset"}}>
					<${InputBox} label="API Key" type=${showKey ? 'text' : 'password'}
						readOnly=${!!cancel}
						placeholder="Enter your OpenRouter API key"
						value=${endpointAPIKey}
						onValueChange=${setEndpointAPIKey}/>
					<button title=${showKey ? "Hide API Key" : "Show API Key"}
						className="eye-button"
						disabled=${!!cancel}
						onClick=${() => setShowKey(!showKey)}>
						${!showKey ? html`<${SVG_ShowKey}/>` : html`<${SVG_HideKey}/>`}
					</button>
				</div>
				<a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer">Get API Key</a>

				<hr />

				<div class="modal-title" style=${{fontSize: '125%'}}>Select Model</div>
				<div className="hbox">
					<${InputBox} label="Search Models" value=${searchTerm} onValueChange=${setSearchTerm} placeholder="Filter models..."/>
					<${SelectBox}
						label="Sort by"
						value=${JSON.stringify(sortBy)}
						onValueChange=${setSortBy}
						options=${[
							{ name: 'Name', value: 'name' },
							{ name: 'Context Length', value: 'context' },
							{ name: 'Price', value: 'pricing' },
						]}/>
					<button onClick=${() => fetchModels(new AbortController().signal)} disabled=${loading}>
						${loading ? 'Refreshing...' : 'Refresh'}
					</button>
				</div>
				${error && html`<div class="error-text">${error}</div>`}
				<div className="overflow-container" style=${{'max-height': '45vh', background: 'var(--color-bg-popover-1)', borderRadius: '4px'}}>
					${loading && !models.length ? html`<div style=${{padding: '1em'}}>Loading models...</div>` : ''}
					${filteredModels.map(model => html`
						<div key=${model.id} 
							className="horde-model-entry" 
							onClick=${() => handleSelect(model.id)}>
							<div class="model-header">
								<input 
									type="radio" 
									checked=${localSelected === model.id} 
									readOnly/>
								<div className="model-name" title=${model.id}>
									${model.name || model.id}
								</div>
							</div>
							<div className="model-stats">
								<span>Context: ${model.context_length ? `${(model.context_length / 1000).toFixed(0)}K` : 'N/A'}</span>
								<span>Input: ${formatPrice(model.pricing?.prompt)}</span>
								<span>Output: ${formatPrice(model.pricing?.completion)}</span>
							</div>
						</div>
					`)}
					${!loading && !filteredModels.length && html`<div style=${{padding: '1em'}}>No models found.</div>`}
				</div>
				<div className="buttons">
					<button onClick=${handleOk}>OK</button>
					<button onClick=${closeModal}>Cancel</button>
				</div>
			</div>
		</${Modal}>`;
}

// 8. Update switchEndpointAPI function (around line 2741)
function switchEndpointAPI(value) {
	let url;
	try {
		url = new URL(endpoint);
	} catch {
		return;
	}
	switch (value) {
		case API_LLAMA_CPP:
			setUseChatAPI(false);
			if (url.protocol != 'http:' && url.protocol != 'https:')
				url.protocol = "http:";
			url.port = 8080;
			break;
		case API_KOBOLD_CPP:
			setUseChatAPI(false);
			if (url.protocol != 'http:' && url.protocol != 'https:')
				url.protocol = "http:";
			url.port = 5001;
			break;
		case API_OPENAI_COMPAT:
			if (url.protocol != 'http:' && url.protocol != 'https:')
				url.protocol = "http:";
			break;
		case API_AI_HORDE:
			setUseChatAPI(false);
			break;
		case API_OPENROUTER: // ADD THIS
			url.protocol = "https:";
			url.hostname = "openrouter.ai";
			url.port = "";
			break;
	}
	setEndpoint(url.toString());
	setEndpointAPI(value);
}

// 9. Update API SelectBox in sidebar (around line 3075)
<${SelectBox}
	label="API"
	disabled=${!!cancel}
	value=${endpointAPI}
	onValueChange=${switchEndpointAPI}
	options=${[
		{ name: 'llama.cpp'        , value: API_LLAMA_CPP },
		{ name: 'KoboldCpp'        , value: API_KOBOLD_CPP },
		{ name: 'OpenAI Compatible', value: API_OPENAI_COMPAT },
		{ name: 'AI Horde'         , value: API_AI_HORDE },
		{ name: 'OpenRouter'       , value: API_OPENROUTER }, // ADD THIS
	]}/>

// 10. Update Server input field (around line 3070)
<${InputBox} label="Server"
	className="${isMixedContent() ? 'mixed-content' : ''}"
	tooltip="${isMixedContent() ? 'This URL might be blocked due to mixed content. If the prediction fails, download mikupad.html and run it locally.' : ''}"
	readOnly=${!!cancel || endpointAPI == API_AI_HORDE || endpointAPI == API_OPENROUTER} // ADD API_OPENROUTER
	value=${endpointAPI == API_AI_HORDE ? 'https://aihorde.net/api' : endpointAPI == API_OPENROUTER ? 'https://openrouter.ai/api' : endpoint} // ADD OPENROUTER CASE
	onValueChange=${setEndpoint}/>

// 11. Update API Key section (around line 3090)
${(endpointAPI != API_AI_HORDE && endpointAPI != API_OPENROUTER) && html` // ADD API_OPENROUTER
	<div className="hbox-flex" style=${{"flex-wrap": "unset"}}>
		<${InputBox} label="API Key" type="${!showAPIKey ? "password" : "text"}"
			className="${rejectedAPIKey ? 'rejected' : ''}"
			tooltip="${rejectedAPIKey ? 'This API Key was rejected by the backend.' : ''}"
			tooltipSize="short"
			readOnly=${!!cancel}
			value=${endpointAPIKey}
			onValueChange=${setEndpointAPIKey}/>
		<button title="${!showAPIKey ? "Show API Key" : "Hide API Key"}"
			className="eye-button"
			disabled=${!!cancel}
			onClick=${() => setShowAPIKey(!showAPIKey)}>
			${!showAPIKey ? html`<${SVG_ShowKey}/>`
							: html`<${SVG_HideKey}/>`}
		</button>
	</div>`}

// 12. Update Model selection section (around line 3100)
${(endpointAPI == API_OPENAI_COMPAT) && html`
	<${InputBox} label="Model"
		datalist=${openaiModels}
		readOnly=${!!cancel}
		value=${endpointModel}
		onValueChange=${setEndpointModel}/>`}
${endpointAPI == API_AI_HORDE && html`
	<div class="vbox" style=${{gap: '4px'}}>
		<${InputBox} label="Selected Model(s)"
			readOnly=${true}
			value=${endpointModel || 'Any'}
			placeholder="Any"
		/>
		<button onClick=${() => toggleModal("horde")}>Configure AI Horde</button>
	</div>`}
${endpointAPI == API_OPENROUTER && html` // ADD THIS ENTIRE BLOCK
	<div class="vbox" style=${{gap: '4px'}}>
		<${InputBox} label="Selected Model"
			readOnly=${true}
			value=${endpointModel || 'None'}
			placeholder="None"
		/>
		<button onClick=${() => toggleModal("openrouter")}>Configure OpenRouter</button>
	</div>`}

// 13. Add modal to JSX (around line 3550)
<${OpenRouterSettingsModal}
	isOpen=${modalState.openrouter}
	closeModal=${() => closeModal("openrouter")}
	endpoint=${endpoint}
	endpointAPIKey=${endpointAPIKey}
	setEndpointAPIKey=${setEndpointAPIKey}
	isMikupadEndpoint=${isMikupadEndpoint}
	sessionStorage=${sessionStorage}
	endpointModel=${endpointModel}
	setEndpointModel=${setEndpointModel}
	cancel=${cancel}/>

// 14. Update token count and other API checks to include OpenRouter
// Search for "endpointAPI == API_OPENAI_COMPAT" and add "|| endpointAPI == API_OPENROUTER" where appropriate
// Examples at lines: 2195, 2237, 2268, 2461, 2578, 2626, 2903, 3125, etc.