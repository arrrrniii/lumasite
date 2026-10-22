import { icon, visual } from './shared.mjs';

// Original secondary pages for the SendMailOS website. These are source
// documents published through LumaSite; no dashboard or customer data is used.
const signup = 'https://dash.sendmailos.com/login';
const docs = 'https://docs.sendmailos.com';

const escape = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

function intro(label, heading, description, { primary = 'Start free', secondary = 'Explore the product', href = '/product' } = {}) {
  return `<section class="page-intro container"><p class="eyebrow">${label}</p><h1>${heading}</h1><p>${description}</p><div class="button-row"><a class="button lime" href="${signup}" data-fx="press">${primary}${icon('arrow')}</a><a class="button light" href="${href}">${secondary}${icon('arrow')}</a></div></section>`;
}

function split(label, heading, copy, type, link = '', reverse = false) {
  return `<section class="container split-section${reverse ? ' reverse' : ''}"><div class="copy-stack"><p class="eyebrow">${label}</p><h2>${heading}</h2>${copy}${link}</div><div class="visual-panel">${visual(type)}<p class="page-note">Illustrative product preview. Sample content.</p></div></section>`;
}

function textLink(href, label) {
  return `<a class="text-link" href="${href}">${label}${icon('arrow')}</a>`;
}

function tiles(heading, description, items) {
  return `<section class="container feature-section"><div class="copy-stack section-heading"><h2>${heading}</h2>${description ? `<p>${description}</p>` : ''}</div><div class="feature-grid">${items.map(({ symbol, title, copy, href, label }) => `<article class="feature-tile">${icon(symbol)}<h3>${title}</h3><p>${copy}</p>${href ? textLink(href, label || 'Explore') : ''}</article>`).join('')}</div></section>`;
}

function faqs(items, heading = 'A few things you might be wondering.') {
  return `<section class="container faq-section"><div class="copy-stack section-heading"><p class="eyebrow">Good questions</p><h2>${heading}</h2></div><div class="faq-list">${items.map(([question, answer]) => `<details><summary>${question}${icon('plus')}</summary><div><p>${answer}</p></div></details>`).join('')}</div></section>`;
}

function cta(heading, copy, primary = 'Create your free account') {
  return `<section class="container cta-band"><div><p class="eyebrow">Make a good connection.</p><h2>${heading}</h2><p>${copy}</p></div><a class="button lime" href="${signup}" data-fx="press">${primary}${icon('arrow')}</a></section>`;
}

const product = {
  slug: 'product',
  title: 'One workspace for every email | SendMailOS',
  description: 'Bring campaigns, email automation, subscriber insights, replies, and your sending API together in SendMailOS. Start with 3,000 free emails a month.',
  html: `<main id="main">
    ${intro('Meet SendMailOS', 'One workspace.<br>Every side of email.', 'A launch announcement. A timely welcome. A customer’s next question. Keep the emails that grow your business close to the tools that run it.', { secondary: 'See plans', href: '/pricing' })}
    ${split('Made for the whole journey', 'The first send is<br>just the beginning.', '<p>Create an email in the visual editor, choose your audience, and send it from your own verified domain. Then follow the response through delivery events, site activity, and customer replies.</p><p>Your marketing team gets a place to create. Your developers get an API to build with. Your audience gets a more connected experience.</p>', 'campaign', textLink('/campaigns', 'Meet your next campaign'))}
    ${tiles('A lot of possibility.<br>A little less switching.', 'Find the right tool for the moment, without scattering your email operation across separate products.', [
      { symbol: 'mail', title: 'Campaigns worth opening.', copy: 'Build reusable templates, organize your audience, and prepare your next announcement with a clear path from draft to send.', href: '/campaigns', label: 'Explore campaigns' },
      { symbol: 'workflow', title: 'A thoughtful follow-up.', copy: 'Turn a signup, tag, or connected event into a journey with emails, delays, and conditions.', href: '/automations', label: 'Explore automations' },
      { symbol: 'pixel', title: 'A clearer next step.', copy: 'Connect website behavior with identified subscribers and build segments around what matters to your business.', href: '/pixel', label: 'Explore Pixel' },
      { symbol: 'inbox', title: 'Room for the reply.', copy: 'Bring outgoing emails and incoming customer replies into conversations your team can follow.', href: '/inbox', label: 'Explore Inbox' },
      { symbol: 'code', title: 'Email inside your product.', copy: 'Send through the HTTP API or SMTP. Connect delivery events to your own application with signed webhooks.', href: '/developers', label: 'Build with the API' },
      { symbol: 'spark', title: 'A creative head start.', copy: 'Connect a compatible MCP assistant to Template Studio and create structured email designs that stay editable.', href: '/developers#template-studio', label: 'Meet Template Studio' },
    ])}
    ${split('Template Studio', 'Start with a brief.<br>Keep every detail yours.', '<p>Describe your next email to a compatible MCP assistant. Template Studio saves the result as editable rows, columns, and blocks in your SendMailOS workspace.</p><p>Open it in the visual editor to change a heading, move an image, restyle a button, or make the whole thing feel more like you.</p>', 'template', textLink('/developers#template-studio', 'See how Template Studio connects'), true)}
    ${tiles('The details that keep<br>everything connected.', 'The daily work belongs here, too. Keep your audience, sending identity, and delivery visibility close to your next idea.', [
      { symbol: 'users', title: 'An audience in order.', copy: 'Import contacts, manage subscribed contacts and tags, and build the right audience for your next message.', href: '/pixel', label: 'Explore audiences' },
      { symbol: 'globe', title: 'Your name on the send.', copy: 'Verify your domain and follow the displayed DNS records for your sending identity, authentication, and tracking.', href: `${docs}/quickstart`, label: 'Set up your domain' },
      { symbol: 'pixel', title: 'Follow the result.', copy: 'Review delivery status, opens, clicks, bounces, campaign reports, and email logs. Retention depends on your plan.', href: '/campaigns', label: 'Explore campaign reporting' },
      { symbol: 'code', title: 'Keys, events, connections.', copy: 'Manage API keys, connect signed webhooks, and inspect deliveries so your application can stay in the loop.', href: '/developers', label: 'Build a connection' },
      { symbol: 'shield', title: 'Your sending infrastructure.', copy: 'On eligible paid plans, connect your own sending server and configure routing for the infrastructure you operate.', href: '/pricing', label: 'Check plan availability' },
      { symbol: 'users', title: 'A shared place to work.', copy: 'Keep work in its organization, manage team membership, and approve scoped connected apps. Team limits vary by plan.', href: '/pricing', label: 'Find your plan' },
    ])}
    ${faqs([
      ['Is SendMailOS for marketers or developers?', 'Both. Create campaigns and workflows in the dashboard, or connect your application through the API and SMTP. Your team can work in the same organization while using the tools that fit their role.'],
      ['Can I use my own sending domain?', 'Yes. Add your domain and publish the DNS records shown in the dashboard. Domain verification connects your sending identity with the platform.'],
      ['Does Template Studio replace the visual editor?', 'The two work together. The MCP assistant creates and updates structured templates; the editor lets you keep refining their individual elements afterward.'],
    ])}
    ${cta('Your next chapter<br>starts with a send.', 'Create an account and start with 3,000 free emails each month.')}
  </main>`,
};

const campaigns = {
  slug: 'campaigns',
  title: 'Email campaigns with room for your ideas | SendMailOS',
  description: 'Design editable email templates, choose your subscribers, send a test, and launch your next campaign from one SendMailOS workspace.',
  html: `<main id="main">
    ${intro('Campaigns', 'Good things deserve<br>a great email.', 'From your first newsletter to your next product launch, make every announcement feel considered. Design, prepare, and send it from one workspace.', { primary: 'Create your first campaign', secondary: 'Explore automations', href: '/automations' })}
    ${split('From an idea to an inbox', 'Make it look<br>like you mean it.', '<p>Build your email with rows, columns, and individual content blocks. Adjust images, type, spacing, and buttons in the visual editor, then reuse the design when the next idea arrives.</p><p>Check your preview and send a test before you reach your subscribers. A good first impression deserves a second look.</p>', 'campaign')}
    ${tiles('The details behind<br>a better send.', 'Bring your message and your audience together before you press send.', [
      { symbol: 'mail', title: 'A design you can return to.', copy: 'Save templates for your recurring newsletters, announcements, and updates. Keep refining the original design rather than rebuilding each email.' },
      { symbol: 'users', title: 'Choose who hears from you.', copy: 'Organize subscribed contacts with tags and audience rules. Give each campaign a group of people it makes sense for.' },
      { symbol: 'mail', title: 'Leave time for a final look.', copy: 'Review your subject, message, audience, and attachments. Send a test, then send now or schedule the campaign for later.' },
    ])}
    ${split('A creative shortcut', 'The blank page<br>is optional.', '<p>Give a compatible MCP assistant a campaign brief, your colors, and a clear call to action. Template Studio creates the design in your SendMailOS organization.</p><p>The result stays fully editable. You can move sections, rewrite the headline, and adjust the mobile layout in the same visual editor you already use.</p>', 'template', textLink('/developers#template-studio', 'Create with Template Studio'), true)}
    ${tiles('The send is only<br>part of the story.', '', [
      { symbol: 'pixel', title: 'See what happens next.', copy: 'Review delivery, opens, clicks, and bounces to understand how a campaign was received. Add Pixel when you want to connect with website activity.', href: '/pixel', label: 'Discover subscriber insights' },
      { symbol: 'inbox', title: 'Make the reply welcome.', copy: 'Enable reply capture for future sends and bring customer responses into your Inbox conversations.', href: '/inbox', label: 'Meet your Inbox' },
      { symbol: 'workflow', title: 'Give the next email a plan.', copy: 'Use a workflow for the welcome sequence or follow-up that should happen beyond a single broadcast.', href: '/automations', label: 'Build a journey' },
    ])}
    ${faqs([
      ['Can I send a test before my campaign?', 'Yes. The campaign editor supports test sends so you can review your email before sending it to its audience.'],
      ['Can I include an attachment?', 'Campaigns support attachments in the editor and review flow. Add them to an unlocked draft and check them in a test send before launch.'],
      ['Can I keep reusing the same design?', 'Yes. Save a template and use it as a starting point for future campaigns. Templates keep their editable structure, including designs created through Template Studio MCP.'],
    ])}
    ${cta('Have something<br>worth sharing?', 'Give it a clear message, a considered design, and a place in someone’s inbox.', 'Start your next campaign')}
  </main>`,
};

const automations = {
  slug: 'automations',
  title: 'Email automation that follows your customer journey | SendMailOS',
  description: 'Build visual email workflows with triggers, delays, conditions, and subscriber actions. Create welcome series and thoughtful follow-ups with SendMailOS.',
  html: `<main id="main">
    ${intro('Automations', 'The right follow-up.<br>Already thought through.', 'A new signup deserves a welcome. A useful first step deserves another. Build email journeys around the moments that matter to your audience.', { primary: 'Build your first workflow', secondary: 'Explore campaigns', href: '/campaigns' })}
    ${split('Your journey, on a canvas', 'See the whole<br>conversation ahead.', '<p>Lay out a journey with a trigger, a message, and a little room between each step. Add conditions where the next email should depend on what a subscriber has done.</p><p>Start with a welcome or onboarding template, or build your own flow from the beginning. Every step stays visible on the canvas.</p>', 'workflow')}
    ${tiles('Thoughtful timing.<br>Clear decisions.', 'A few building blocks can make the next email feel a lot more relevant.', [
      { symbol: 'spark', title: 'Start with a real moment.', copy: 'Trigger a journey with a new subscriber, an added tag, a date, an audience, or a connected event.' },
      { symbol: 'workflow', title: 'Give the journey space.', copy: 'Add delays in minutes, hours, days, or weeks. Put a useful pause between a welcome, a tip, and a follow-up.' },
      { symbol: 'users', title: 'Let the path branch.', copy: 'Use conditions such as tags, subscriber fields, opens, or clicks to decide which step comes next.' },
    ])}
    ${split('A useful place to begin', 'Make their first<br>few days feel easy.', '<p>Welcome a new subscriber with a short introduction. Wait a day, share one useful thing, then choose the next message based on their progress.</p><p>The same building blocks can support onboarding, a launch sequence, or a return invitation. Start with the moment you want to improve.</p>', 'template', textLink('/campaigns', 'Create the emails in your journey'), true)}
    <section class="container feature-section"><div class="copy-stack section-heading"><p class="eyebrow">Build it around your business</p><h2>Three journeys.<br>One place to build them.</h2></div><div class="feature-grid"><article class="feature-tile"><span class="eyebrow">A warmer welcome</span><h3>From “you’re in” to “here’s how.”</h3><p>A new subscriber joins. Send a welcome, introduce your best resource, and follow up after a considered pause.</p></article><article class="feature-tile"><span class="eyebrow">A clearer first step</span><h3>Help people find their footing.</h3><p>Use a signup event and subscriber tags to guide people through a product introduction at a pace you choose.</p></article><article class="feature-tile"><span class="eyebrow">A little reconnection</span><h3>Give the relationship another opening.</h3><p>Use your audience rules and connected events to invite an existing subscriber back with something useful.</p></article></div></section>
    ${faqs([
      ['Do I need to write code to build a workflow?', 'The visual canvas lets you arrange triggers, emails, delays, and conditions in the dashboard. Developers can use the API when a journey needs to connect with application events.'],
      ['Can different subscribers follow different paths?', 'Yes. Conditions create branches based on supported subscriber and email rules, so a journey does not have to send the same next message to everyone.'],
      ['Where do the emails in a workflow come from?', 'Design your emails with the platform’s email tools and use them in the journey. Templates give you a consistent starting point for the sequence.'],
    ])}
    ${cta('Make the next email<br>feel like a natural step.', 'Start with one moment. Build a better journey from there.', 'Start building a journey')}
  </main>`,
};

const pixel = {
  slug: 'pixel',
  title: 'Connect website behavior with subscriber insights | SendMailOS Pixel',
  description: 'Connect website events with identified subscribers. Explore behavior, build saved segments, and bring more context to email with SendMailOS Pixel.',
  html: `<main id="main">
    ${intro('SendMailOS Pixel', 'A little more context.<br>A much better next step.', 'Your website has a story to tell. Connect its activity with identified subscribers, then use that context to build a more relevant audience.', { primary: 'Explore Pixel in your workspace', secondary: 'See the whole platform', href: '/product' })}
    ${split('From activity to understanding', 'Know what<br>caught their attention.', '<p>Add your Pixel installation snippet to your website and connect the events your business cares about. Explore page visits, product views, and events such as cart activity or recorded purchases.</p><p>Signed links in your emails connect visits with existing subscribers. Anonymous traffic remains distinct from subscribed contacts you can email.</p>', 'pixel')}
    ${tiles('Make the audience<br>fit the moment.', 'Go beyond a single list with rules grounded in subscriber activity.', [
      { symbol: 'globe', title: 'Start with the website.', copy: 'Choose a domain and time window. Look for activity on relevant pages, such as your product information or pricing.' },
      { symbol: 'pixel', title: 'Define what matters.', copy: 'Combine supported website and email rules. Build an audience around engagement, recorded purchases, or a return visit.' },
      { symbol: 'users', title: 'Keep your useful audiences.', copy: 'Save segment definitions for later. Live segments reevaluate their rules; an applied tag is a separate snapshot of the contacts you chose.' },
    ])}
    ${split('Your settings, your choice', 'Context starts<br>with considered tracking.', '<p>Choose how analytics permission is handled, connect a supported consent manager, and configure the domains allowed to use your Pixel.</p><p>The dashboard brings installation health, recent events, and segment tools together, so you can check your setup before relying on its signals.</p>', 'workflow', textLink('/automations', 'Put that context into a journey'), true)}
    ${faqs([
      ['Does Pixel turn anonymous visitors into subscribers?', 'No. Website activity and an email subscription are different things. Email audiences are built from identified subscribed contacts that match the selected rules.'],
      ['What is the difference between a saved segment and a tag?', 'A saved segment keeps a rule definition that can be reevaluated. Applying a tag to a behavior audience creates a one-time snapshot; that tag does not automatically disappear when someone stops matching the rule.'],
      ['Do I need to add event tracking?', 'Install the Pixel snippet, then connect any additional events and identity information your use case requires. A purchase or cart event needs to be sent by your website or integration; the platform does not invent those events.'],
      ['Can I control when tracking begins?', 'Yes. Pixel has consent-mode and consent-manager options. Choose the configuration appropriate for your website and the permissions you obtain from its visitors.'],
    ])}
    ${cta('Bring a little more<br>understanding to email.', 'Connect your website, define a useful audience, and plan a more relevant next message.', 'Get started with Pixel')}
  </main>`,
};

const inbox = {
  slug: 'inbox',
  title: 'Keep email replies in the conversation | SendMailOS Inbox',
  description: 'Send emails, receive customer replies, and follow the conversation in SendMailOS Inbox. Connect native email conversations to your own application.',
  html: `<main id="main">
    ${intro('SendMailOS Inbox', 'An email can start<br>a conversation.', 'Give the reply somewhere to go. Keep customer messages connected with the emails you send, and make the next response easier to follow.', { primary: 'Open your workspace', secondary: 'Read the conversation guide', href: `${docs}/guides/conversations` })}
    ${split('Make room for “reply”', 'Keep both sides<br>of the conversation.', '<p>Configure receiving, send an email, and receive the customer’s reply in a conversation. Read the thread, reply from the dashboard, and mark it read or closed when you have what you need.</p><p>A new customer reply brings the conversation back. The context stays with the message instead of becoming another disconnected email.</p>', 'inbox')}
    ${tiles('A connected inbox.<br>A clearer response.', '', [
      { symbol: 'mail', title: 'Capture future replies.', copy: 'Enable reply capture for supported future sends through the shared API, SMTP, campaign, and workflow pipeline.' },
      { symbol: 'inbox', title: 'Follow the thread.', copy: 'Keep outgoing messages and incoming replies together. Review the conversation before writing the next response.' },
      { symbol: 'globe', title: 'Use a reply identity that fits.', copy: 'Use the platform reply address or set up a verified receiving subdomain with the DNS records shown in your workspace.' },
    ])}
    ${split('For the product you are building', 'The conversation<br>can live in your app.', '<p>Create a conversation through the API, send a reply, and subscribe to signed <code>email.received</code> webhooks. Fetch the messages when your application needs to display the thread.</p><p>Use your own reference ID to connect a conversation with a booking, order, or support request in your product.</p>', 'api', textLink(`${docs}/guides/conversations`, 'Read the native conversations guide'), true)}
    ${faqs([
      ['Is Inbox a general-purpose business mailbox?', 'Inbox is built for reply conversations connected to your outgoing email. It is not a general IMAP mailbox replacement for your existing business email.'],
      ['Will it capture replies to emails I already sent?', 'Enabling reply capture applies to future supported sends. Previously sent messages keep the Reply-To address they had when they were sent.'],
      ['Can my application receive incoming-message events?', 'Yes. Subscribe to the signed email.received webhook, then fetch the conversation and message through the authenticated API.'],
      ['Can I use my own reply subdomain?', 'Yes. Add a receiving subdomain under a verified domain, publish the displayed ownership and MX records, and check its DNS before selecting it for replies.'],
    ])}
    ${cta('Keep the conversation<br>going.', 'Give your next message a place for the answer.', 'Get started with Inbox')}
  </main>`,
};

const emailExample = `curl https://api.sendmailos.com/v1/emails \\
  -H "Authorization: Bearer sk_live_your_key" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: your-unique-request-id" \\
  -d '{
    "from": "hello@yourdomain.com",
    "to": "customer@example.com",
    "subject": "A good place to start",
    "html": "<h1>Welcome aboard.</h1>"
  }'`;

const developers = {
  slug: 'developers',
  title: 'Email API, SMTP, webhooks, and Template MCP | SendMailOS',
  description: 'Build email into your application with the SendMailOS API, SMTP, and signed webhooks. Connect Template Studio MCP for fully editable email templates.',
  html: `<main id="main">
    ${intro('For developers', 'Good email.<br>Part of your product.', 'Send a password reset, launch a campaign, or keep a customer conversation moving. Connect your application to the same email workspace your team uses.', { primary: 'Get an API key', secondary: 'Read the quickstart', href: `${docs}/quickstart` })}
    ${split('A straightforward first send', 'Your application.<br>Your verified domain.', '<p>Create an API key, verify your sending domain, and make a request to <code>POST /v1/emails</code>. Use the email ID and delivery events to follow what happens next.</p><p>Test-mode keys let you simulate development sends without delivering to real mailboxes. Use an idempotency key when retrying the same send request.</p>', 'api', textLink(`${docs}/quickstart`, 'Send your first email'))}
    <section class="container split-section reverse"><div class="copy-stack"><p class="eyebrow">A small request. A useful beginning.</p><h2>Make email<br>part of the flow.</h2><p>Use plain HTTP from your backend. Start with one message, then explore templates, subscribers, broadcasts, workflows, and conversations as your product grows.</p><p>A <code>202 Accepted</code> response means the message was accepted for processing. Check its status or subscribe to a delivery webhook for the result.</p>${textLink(`${docs}/authentication`, 'Explore authentication and scopes')}</div><div class="visual-panel code-panel"><div class="code-panel-label">Send an email · cURL</div><pre><code>${escape(emailExample)}</code></pre><p class="page-note">Replace the example key and addresses with your own verified sending details.</p></div></section>
    ${tiles('Connect the pieces<br>your product needs.', '', [
      { symbol: 'mail', title: 'SMTP for the tools you use.', copy: 'Connect an application or WordPress mail plugin with a sending-only SMTP password. Use STARTTLS on port 2525 or implicit TLS on port 2465.', href: `${docs}/guides/smtp`, label: 'Read the SMTP guide' },
      { symbol: 'workflow', title: 'Events you can build on.', copy: 'Receive signed delivery, open, click, bounce, and incoming-message events. Verify signatures and make your receiver safe to retry.', href: `${docs}/guides/webhooks`, label: 'Connect a webhook' },
      { symbol: 'inbox', title: 'Conversations in your app.', copy: 'Create a thread, send a message, and receive the reply event. Tie a conversation to the booking or order it belongs to.', href: `${docs}/guides/conversations`, label: 'Explore the conversation API' },
    ])}
    <section class="container split-section" id="template-studio"><div class="copy-stack"><p class="eyebrow">Template Studio MCP</p><h2>Describe the email.<br>Keep it editable.</h2><p>Connect a compatible remote MCP client to Template Studio. Ask it to create a responsive email or update an existing template in an organization you have approved.</p><p>The assistant saves structured rows, columns, and blocks. Your team can keep editing the design in SendMailOS after the conversation ends.</p><p><code>https://dash.sendmailos.com/api/mcp</code></p>${textLink(`${docs}/guides/mcp-template-studio`, 'Read the Template Studio setup guide')}</div><div class="visual-panel">${visual('template')}<p class="page-note">Illustrative template preview. Individual elements stay editable.</p></div></section>
    ${tiles('A considered connection.<br>From the first request.', '', [
      { symbol: 'shield', title: 'Approve template access.', copy: 'The remote MCP connection uses OAuth with PKCE. Sign in to SendMailOS, choose the organizations, and approve the template permissions shown.' },
      { symbol: 'users', title: 'Choose the workspace.', copy: 'Name an approved organization in your prompt. Tools resolve its ID and keep the template in that organization.' },
      { symbol: 'spark', title: 'Keep a human hand in the design.', copy: 'Refine generated content in the visual editor. Template MCP manages editable templates and offers additional read tools when their permissions are approved.' },
    ])}
    ${faqs([
      ['Do I need a particular SDK?', 'No. The HTTP API works with standard requests from your backend. The documentation includes request shapes and examples to help you integrate with your stack.'],
      ['Can I use the same API for marketing and transactional email?', 'The platform supports both. Use email sends for application messages, and the broadcast and subscriber resources for audience-oriented sending.'],
      ['Do I paste my API key into an MCP assistant?', 'No. Template Studio’s remote MCP connection uses OAuth. Your client opens SendMailOS so you can sign in and approve access without sharing an API key or password in chat.'],
      ['Can Template MCP control every part of my account?', 'Template MCP creates, edits, renders, and publishes templates in approved organizations. With additional permissions, it can also read subscribers, broadcasts, and email analytics. It does not send campaigns or change workflows.'],
    ])}
    ${cta('Build something<br>people want to hear from.', 'Start with the quickstart. Keep building with the API.', 'Create your developer account')}
  </main>`,
};

const pricing = {
  slug: 'pricing',
  title: 'Start with 3,000 free emails a month | SendMailOS pricing',
  description: 'Start sending with 3,000 free emails each month. Explore the SendMailOS workspace, then choose the plan and sending capacity that fit your business.',
  html: `<main id="main">
    ${intro('Pricing', 'A good place<br>to start sending.', 'Start with 3,000 free emails each month. Find your rhythm, build your audience, and choose more room when your business needs it.', { secondary: 'Explore the platform', href: '/product' })}
    <section class="container pricing-section"><article class="pricing-plan free-plan"><p class="eyebrow">Start here</p><h2>Free</h2><div class="plan-amount">€0<span>to get started</span></div><p class="plan-allowance"><strong>3,000</strong> emails / month</p><p>A place to put your first idea into someone’s inbox.</p><ul class="plan-list"><li>${icon('check')}Up to 2,000 subscribed contacts</li><li>${icon('check')}1 verified sending domain</li><li>${icon('check')}3 workflows, 10 templates, and 1 Pixel</li></ul><a class="button lime" href="${signup}" data-fx="press">Start free${icon('arrow')}</a><p class="page-note">Usage limits apply. Your workspace shows your current allowances and reset period.</p></article><article class="pricing-plan growth-plan"><p class="eyebrow">When your next chapter arrives</p><h2>More room<br>for what’s next.</h2><p>More sending, a growing audience, or a larger operation. Review the current plans, included limits, and available options in your SendMailOS workspace.</p><ul class="plan-list"><li>${icon('check')}Choose capacity around your needs</li><li>${icon('check')}Review your plan and usage together</li><li>${icon('check')}Explore eligible paid features and add-ons</li></ul><a class="button light" href="${signup}">View current plans${icon('arrow')}</a><p class="page-note">Paid pricing and entitlements are shown in the dashboard before you choose a plan.</p></article></section>
    ${tiles('What will you<br>make room for?', 'One platform can support the different sides of your email operation. Availability and limits depend on your plan.', [
      { symbol: 'mail', title: 'Your next announcement.', copy: 'Bring a campaign to life with editable templates and a considered message for your audience.', href: '/campaigns', label: 'Explore campaigns' },
      { symbol: 'workflow', title: 'A more connected journey.', copy: 'Create a welcome or follow-up sequence with the visual workflow tools.', href: '/automations', label: 'Explore automations' },
      { symbol: 'code', title: 'Email inside your product.', copy: 'Connect the API, SMTP, and delivery webhooks to the application you are building.', href: '/developers', label: 'Explore developer tools' },
    ])}
    ${faqs([
      ['How many free emails can I send?', 'The Free plan includes 3,000 email credits per monthly allowance window. A hosted send uses one credit per recipient. Your dashboard shows your usage, available capacity, and reset period.'],
      ['Where can I see paid prices and plan limits?', 'Sign in to your SendMailOS workspace and open Subscription & Billing. Review the current plans, prices, included allowances, and available options before making a selection.'],
      ['Can I send both application emails and campaigns?', 'SendMailOS supports transactional sends and marketing campaigns in the same platform. They remain subject to your account’s sending allowance and applicable limits.'],
      ['Is Bring Your Own Server included in Free?', 'Bring Your Own Server is available on eligible paid plans. Review its availability and requirements in your workspace before planning a connected-server setup.'],
      ['Can I explore the product before choosing a paid plan?', 'Yes. Start with a free account and its monthly sending allowance. Your workspace shows which features and limits are available to your organization.'],
    ], 'A clearer picture<br>before your first send.')}
    ${cta('Your first 3,000 emails<br>have somewhere to go.', 'Start free. Make the next message worth sending.')}
  </main>`,
};

const resources = {
  slug: 'resources',
  title: 'Guides for your next email integration | SendMailOS resources',
  description: 'Find the SendMailOS quickstart, API reference, SMTP setup, webhook verification, conversations guide, and editable Template Studio MCP documentation.',
  html: `<main id="main">
    ${intro('Resources', 'A good next step.<br>Clearly explained.', 'Practical guides for your first send, your next integration, and the details in between. Go straight to the documentation that moves your work forward.', { primary: 'Open your workspace', secondary: 'Browse all documentation', href: docs })}
    ${split('Start here', 'One verified domain.<br>One accepted send.', '<p>The quickstart walks through creating an API key, verifying your sending domain, making your first request, and following the delivery result.</p><p>Use it as your first working connection, then build out the rest of your integration at your own pace.</p>', 'api', textLink(`${docs}/quickstart`, 'Follow the email quickstart'))}
    ${tiles('Connect what<br>you already use.', 'The setup guides, without the search through old release notes.', [
      { symbol: 'mail', title: 'Set up SMTP.', copy: 'Connection details, TLS ports, sending passwords, verified domains, and a practical WordPress setup.', href: `${docs}/guides/smtp`, label: 'Read the SMTP guide' },
      { symbol: 'workflow', title: 'Receive delivery events.', copy: 'Create an endpoint, verify its challenge, check webhook signatures, and handle retries.', href: `${docs}/guides/webhooks`, label: 'Read the webhook guide' },
      { symbol: 'inbox', title: 'Build a conversation.', copy: 'Create a thread, send a message, receive a reply, and connect it with your application.', href: `${docs}/guides/conversations`, label: 'Read the conversation guide' },
    ])}
    ${split('A creative workflow, connected', 'Bring your brief.<br>Keep your design.', '<p>Connect a compatible assistant to Template Studio MCP using the remote server URL and OAuth. Choose your organizations, describe the email, and save an editable template.</p><p>The guide explains the connection, supported template operations, and how to keep control of organization access.</p>', 'template', textLink(`${docs}/guides/mcp-template-studio`, 'Set up Template Studio MCP'), true)}
    ${tiles('A few details<br>worth getting right.', 'Keep these guides close as your first request becomes a production integration.', [
      { symbol: 'shield', title: 'Authentication and scopes.', copy: 'Understand live keys, simulated test sends, OAuth grants, and the permissions attached to each request.', href: `${docs}/authentication`, label: 'Read authentication' },
      { symbol: 'code', title: 'Make a retry safe.', copy: 'Use idempotency keys to retry the same email request without intentionally creating another send.', href: `${docs}/guides/idempotency`, label: 'Read idempotency' },
      { symbol: 'check', title: 'Understand the response.', copy: 'Read request IDs, structured errors, and retryable responses so your application can take the right next step.', href: `${docs}/guides/responses-and-errors`, label: 'Read responses and errors' },
    ])}
    <section class="container cta-band"><div><p class="eyebrow">The full reference</p><h2>Find the resource.<br>Build the next step.</h2><p>Explore the API reference for email sends, domains, subscribers, broadcasts, workflows, and webhooks.</p></div><a class="button lime" href="${docs}">Open the documentation${icon('arrow')}</a></section>
  </main>`,
};

export const pages = [product, campaigns, automations, pixel, inbox, developers, pricing, resources];
