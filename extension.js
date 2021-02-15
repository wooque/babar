/* 
	BaBar
	by Francois Thirioux
	GitHub contributors: @fthx, @wooque
	License GPL v3
*/


const { Clutter, Gio, GLib, GObject, Meta, Shell, St } = imports.gi;

const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const AppFavorites = imports.ui.appFavorites;
const AppMenu = Main.panel.statusArea.appMenu;
const WM = global.workspace_manager;
const Util = imports.misc.util;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

// translation needed to restore Places label, if any
const Gettext = imports.gettext.domain('gnome-shell-extensions');
const _ = Gettext.gettext;
const N_ = x => x;

// workspaces names from native schema
var WORKSPACES_SCHEMA = "org.gnome.desktop.wm.preferences";
var WORKSPACES_KEY = "workspace-names";

// initial fallback settings
var REDUCE_PADDING = false;
var APP_GRID_ICON_NAME = 'view-app-grid-symbolic';
var PLACES_ICON_NAME = 'folder-symbolic';
var FAVORITES_ICON_NAME = 'starred-symbolic';
var FALLBACK_ICON_NAME = 'applications-system-symbolic';
var ICON_SIZE = 20;
var ROUNDED_WORKSPACES_BUTTONS = true;
var TOOLTIP_VERTICAL_PADDING = 10;
var HIDDEN_OPACITY = 127;
var UNFOCUSED_OPACITY = 255;
var FOCUSED_OPACITY = 255;
var DESATURATE_ICONS = false;
var DISPLAY_ACTIVITIES = false;
var DISPLAY_APP_GRID = true;
var DISPLAY_PLACES_ICON = true;
var DISPLAY_FAVORITES = true;
var DISPLAY_WORKSPACES = true;
var DISPLAY_TASKS = true;
var DISPLAY_APP_MENU = false;


var AppGridButton = GObject.registerClass(
class AppGridButton extends PanelMenu.Button {
	_init() {
		super._init(0.0, 'Babar-AppGrid');
		
		this.app_grid_button = new St.BoxLayout({visible: true, reactive: true, can_focus: true, track_hover: true});
		this.app_grid_button.icon = new St.Icon({icon_name: APP_GRID_ICON_NAME, style_class: 'system-status-icon'});
        this.app_grid_button.add_child(this.app_grid_button.icon);
        this.app_grid_button.connect('button-press-event', () => Main.overview.viewSelector._toggleAppsPage());
        this.add_child(this.app_grid_button);
	}
	
	_destroy() {
		super.destroy();
	}
});


var FavoritesMenu = GObject.registerClass(
class FavoritesMenu extends PanelMenu.Button {
	_init() {
		super._init(0.0, 'Babar-Favorites');
		
		// listen to favorites changes
		this.fav_changed = AppFavorites.getAppFavorites().connect('changed', this._display_favorites.bind(this));
		
		// make menu button
    	this.button = new St.BoxLayout({});
		this.icon = new St.Icon({icon_name: FAVORITES_ICON_NAME, style_class: 'system-status-icon'});
        this.button.add_child(this.icon);
        this.button.add_child(PopupMenu.arrowIcon(St.Side.BOTTOM));
        this.add_child(this.button);

		// display favorites list
		this._display_favorites();
	}
	
	// display favorites menu
	_display_favorites() {
		// destroy old menu items
		if (this.menu) {
			this.menu.removeAll();
		}
		
		// get favorites list
    	this.list_fav = AppFavorites.getAppFavorites().getFavorites();
        
        // create favorites items
    	for (let fav_index = 0; fav_index < this.list_fav.length; ++fav_index) {
    		// get favorite app, name and icon
    		this.fav = this.list_fav[fav_index];
    		this.fav_icon = this.fav.create_icon_texture(ICON_SIZE);
    		this.fav_label = new St.Label({text: this.fav.get_name()});
    		
    		// create menu item
    		this.item = new PopupMenu.PopupBaseMenuItem;
    		this.item_box = new St.BoxLayout({style_class: 'favorite', vertical: false});
    		this.item_box.add_child(this.fav_icon);
    		this.item_box.add_child(this.fav_label);
    		this.item.connect('activate', () => this._activate_fav(fav_index));
    		this.item.add_child(this.item_box);
    		this.menu.addMenuItem(this.item);
    	}
	}
	
	// activate favorite
    _activate_fav(fav_index) {
    	AppFavorites.getAppFavorites().getFavorites()[fav_index].open_new_window(-1);
    }
    
    // remove signals, destroy workspaces bar
	_destroy() {
		AppFavorites.getAppFavorites().disconnect(this.fav_changed);
		super.destroy();
	}
});

var WorkspacesBar = GObject.registerClass(
class WorkspacesBar extends PanelMenu.Button {
	_init() {
		super._init(0.0, 'Babar-Tasks');
		
		// tracker for windows
		this.window_tracker = Shell.WindowTracker.get_default();
		
		// define gsettings schema for workspaces names, get workspaces names, signal for settings key changed
		this.workspaces_settings = new Gio.Settings({schema: WORKSPACES_SCHEMA});
		this.workspaces_names_changed = this.workspaces_settings.connect(`changed::${WORKSPACES_KEY}`, this._update_workspaces_names.bind(this));
		
		// bar creation
		this.ws_bar = new St.BoxLayout({});
        this._update_workspaces_names();
        this.add_child(this.ws_bar);
        
        // window button tooltip creation
        this.window_tooltip = new St.BoxLayout({style_class: 'window-tooltip'});
		this.window_tooltip.label = new St.Label({y_align: Clutter.ActorAlign.CENTER, text: ""});
		this.window_tooltip.add_child(this.window_tooltip.label);
		this.window_tooltip.hide();
		Main.layoutManager.addChrome(this.window_tooltip);
        
        // signals
		this._ws_number_changed = WM.connect('notify::n-workspaces', this._update_ws.bind(this));
		this._restacked = global.display.connect('restacked', this._update_ws.bind(this));
		this._window_left_monitor = global.display.connect('window-left-monitor', this._update_ws.bind(this));
	}

	// remove signals, restore Activities button, destroy workspaces bar
	_destroy() {
		this.workspaces_settings.disconnect(this.workspaces_names_changed);
		WM.disconnect(this._ws_number_changed);
		global.display.disconnect(this._restacked);
		global.display.disconnect(this._window_left_monitor);
		if (this.hide_tooltip_timeout) {
			GLib.source_remove(this.hide_tooltip_timeout);
		}
		this.ws_bar.destroy();
		super.destroy();
	}
	
	// update workspaces names
	_update_workspaces_names() {
		this.workspaces_names = this.workspaces_settings.get_strv(WORKSPACES_KEY);
		this._update_ws();
	}

	// update the workspaces bar
    _update_ws() {
    	var ws_box;
    	var ws_box_label;
    	
    	// destroy old workspaces bar buttons and signals
    	this.ws_bar.destroy_all_children();
    	
    	// get number of workspaces
        this.ws_count = WM.get_n_workspaces();
        this.active_ws_index = WM.get_active_workspace_index();
        		
		// display all current workspaces and tasks buttons
        for (let ws_index = 0; ws_index < this.ws_count; ++ws_index) {
        	// workspace
			ws_box = new St.Bin({visible: true, reactive: true, can_focus: true, track_hover: true});						
			ws_box_label = new St.Label({y_align: Clutter.ActorAlign.CENTER});
			
			if (!ROUNDED_WORKSPACES_BUTTONS) {
				if (ws_index == this.active_ws_index) {
					ws_box_label.style_class = 'workspace-active-squared';
				} else {
					ws_box_label.style_class = 'workspace-inactive-squared';
				}
			} else {
				if (ws_index == this.active_ws_index) {
					ws_box_label.style_class = 'workspace-active-rounded';
				} else {
					ws_box_label.style_class = 'workspace-inactive-rounded';
				}
			}
			
			if (this.workspaces_names[ws_index]) {
				ws_box_label.set_text("  " + this.workspaces_names[ws_index] + "  ");
			} else {
				ws_box_label.set_text("  " + (ws_index + 1) + "  ");
			}
			ws_box.set_child(ws_box_label);
			ws_box.connect('button-press-event', () => this._toggle_ws(ws_index));
			if (DISPLAY_WORKSPACES) {
	        	this.ws_bar.add_child(ws_box);
	        }
	        
	        // tasks
	        this.ws_current = WM.get_workspace_by_index(ws_index);
	        this.ws_current.windows = this.ws_current.list_windows().sort(this._sort_windows);
	        for (let window_index = 0; window_index < this.ws_current.windows.length; ++window_index) {
	        	this.window = this.ws_current.windows[window_index];
	        	// don't make a button for dropdown menu
	        	if (this.window && !(this.window.get_window_type() == Meta.WindowType.DROPDOWN_MENU)) {
	        		this._create_window_button(ws_index, this.window);
	        	}
	        }
		}
    }
    
    // create window button ; ws = workspace, w = window
    _create_window_button(ws_index, window) {
    	var w_box;
    	var w_box_app;
    	var w_box_icon;
    	
        // windows on all workspaces have to be displayed only once
    	if (!window.is_on_all_workspaces() || ws_index == 0) {
		    // create button
			w_box = new St.Bin({visible: true, reactive: true, can_focus: true, track_hover: true});
			w_box.connect('button-press-event', () => this._toggle_window(ws_index, window));
			w_box.connect('notify::hover', () => this._show_tooltip(w_box, window.title));
		    w_box_app = this.window_tracker.get_window_app(window);
		    
		    // create icon
		    if (w_box_app) {
		    	w_box_icon = w_box_app.create_icon_texture(ICON_SIZE);
		    }
		    // sometimes no icon is defined or icon is void
		    if (!w_box_icon || w_box_icon.get_style_class_name() == 'fallback-app-icon') {
		    	w_box_icon = new St.Icon({icon_name: FALLBACK_ICON_NAME, style_class: 'system-status-icon'});
			}
			
			// desaturate option
			if (DESATURATE_ICONS) {
				this.desaturate = new Clutter.DesaturateEffect();
				w_box_icon.add_effect(this.desaturate);
			}
		    
			// set icon style and opacity following window state
		    if (window.is_hidden()) {
				w_box.style_class = 'window-hidden';
				w_box_icon.set_opacity(HIDDEN_OPACITY);
		    } else {
				if (window.has_focus()) {
				w_box.style_class = 'window-focused';
				w_box_icon.set_opacity(FOCUSED_OPACITY);
				} else {
				w_box.style_class = 'window-unfocused';
				w_box_icon.set_opacity(UNFOCUSED_OPACITY);
				}
		    }
        
		    // add button in task bar
		   	w_box.set_child(w_box_icon);
		   	if (window.is_on_all_workspaces()) {
		   		this.ws_bar.insert_child_at_index(w_box, 0);	
		   	} else {
		    	this.ws_bar.add_child(w_box);
		    }
		}
	}
	
	// switch to workspace and toggle window
    _toggle_window(ws_index, window) {
	    if (WM.get_active_workspace_index() == ws_index && window.has_focus() && !(Main.overview.visible)) {
	   		window.minimize();
	   	} else {	
			window.activate(global.get_current_time());
		}
		if (Main.overview.visible) {
			Main.overview.hide();
		}
		if (!(window.is_on_all_workspaces())) {
			WM.get_workspace_by_index(ws_index).activate(global.get_current_time());
		}
    }
    
    // sort windows by creation date
    _sort_windows(window1, window2) {
    	return window1.get_id() - window2.get_id();
    }

    // toggle or show overview
    _toggle_ws(ws_index) {
		if (ws_index == WM.get_active_workspace_index()) {
			Main.overview.toggle();
		} else {
			WM.get_workspace_by_index(ws_index).activate(global.get_current_time());
			Main.overview.show();
		}
    }
    
    // show window tooltip
    _show_tooltip(w_box, window_title) {
		if (window_title && w_box.hover) {
			this.window_tooltip.set_position(w_box.get_transformed_position()[0], Main.layoutManager.primaryMonitor.y + Main.panel.height + TOOLTIP_VERTICAL_PADDING);
			this.window_tooltip.label.set_text(window_title);
			this.window_tooltip.show();
			this.hide_tooltip_timeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => this.window_tooltip.hide())
		} else {
			this.window_tooltip.hide();
		}
    }
});

class Extension {
	constructor() {
	}
	
	// get settings
    _get_settings() {
        this.settings = ExtensionUtils.getSettings('org.gnome.shell.extensions.babar');
        
        // watch settings changes
        this.settings_already_changed = false;
		this.settings_changed = this.settings.connect('changed', this._settings_changed.bind(this)
		);
		
		// get settings values
		REDUCE_PADDING = this.settings.get_boolean('reduce-padding');
		APP_GRID_ICON_NAME = this.settings.get_string('app-grid-icon-name');
		PLACES_ICON_NAME = this.settings.get_string('places-icon-name');
		FAVORITES_ICON_NAME = this.settings.get_string('favorites-icon-name');
		FALLBACK_ICON_NAME = this.settings.get_string('fallback-icon-name');
		ICON_SIZE = this.settings.get_int('icon-size');
		ROUNDED_WORKSPACES_BUTTONS = this.settings.get_boolean('rounded-workspaces-buttons');
		TOOLTIP_VERTICAL_PADDING = this.settings.get_int('tooltip-vertical-padding');
		HIDDEN_OPACITY = this.settings.get_int('hidden-opacity');
		UNFOCUSED_OPACITY = this.settings.get_int('unfocused-opacity');
		FOCUSED_OPACITY = this.settings.get_int('focused-opacity');
		DESATURATE_ICONS = this.settings.get_boolean('desaturate-icons');
		DISPLAY_ACTIVITIES = this.settings.get_boolean('display-activities');
		DISPLAY_APP_GRID = this.settings.get_boolean('display-app-grid');
		DISPLAY_PLACES_ICON = this.settings.get_boolean('display-places-icon');
		DISPLAY_FAVORITES = this.settings.get_boolean('display-favorites');
		DISPLAY_WORKSPACES = this.settings.get_boolean('display-workspaces');
		DISPLAY_TASKS = this.settings.get_boolean('display-tasks');
		DISPLAY_APP_MENU = this.settings.get_boolean('display-app-menu');
    }
    
    // restart extension after settings changed
    _settings_changed() {
    	if (!this.settings_already_changed) {
    		Main.notify("Please restart BaBar extension to apply changes.");
    		this.settings_already_changed = true;
    	}
    }    
    
    // toggle Activities button
	_show_activities(show) {
		this.activities_button = Main.panel.statusArea['activities'];
		if (this.activities_button) {
			if (show && !Main.sessionMode.isLocked) {
				this.activities_button.container.show();
			} else {
				this.activities_button.container.hide();
			}
		}
	}
	
	// toggle Places Status Indicator extension label to folder	
	_show_places_icon(show_icon) {
		this.places_indicator = Main.panel.statusArea['places-menu'];
		if (this.places_indicator) {
			this.places_box = this.places_indicator.get_first_child();
			this.places_box.remove_child(this.places_box.get_first_child());
			if (show_icon) {
				this.places_icon = new St.Icon({icon_name: PLACES_ICON_NAME, style_class: 'system-status-icon'});
				this.places_box.insert_child_at_index(this.places_icon, 0);
			} else {
				this.places_label = new St.Label({text: _('Places'), y_expand: true, y_align: Clutter.ActorAlign.CENTER});
				this.places_box.insert_child_at_index(this.places_label, 0);
			}
		}
	}

    enable() {    
    	// get settings
    	this._get_settings();
    	
    	// reduce top panel left box padding
    	if (REDUCE_PADDING) {
    		Main.panel._leftBox.add_style_class_name('leftbox-reduced-padding');
    	}
    
    	// hide Activities button
    	if (!DISPLAY_ACTIVITIES) {
    		this._show_activities(false);
    	}
    	
    	// display app grid
		if (DISPLAY_APP_GRID) {
			this.app_grid = new AppGridButton();
			Main.panel.addToStatusArea('babar-app-grid-button', this.app_grid, 0, 'left');
		}
		
		// if Places extension is installed, change label to icon
		if (DISPLAY_PLACES_ICON) {
			this._show_places_icon(true);
			this.extensions_changed = Main.extensionManager.connect('extension-state-changed', () => this._show_places_icon(true));
		}
		
		// display favorites
		if (DISPLAY_FAVORITES) {
			this.favorites_menu = new FavoritesMenu();
			Main.panel.addToStatusArea('babar-favorites-menu', this.favorites_menu, 3, 'left');
		}
		
		// display tasks
		if (DISPLAY_TASKS) {
			this.workspaces_bar = new WorkspacesBar();
			Main.panel.addToStatusArea('babar-workspaces-bar', this.workspaces_bar, 4, 'left');
		}
		
		// hide AppMenu
    	if (!DISPLAY_APP_MENU) {
			AppMenu.container.hide();
		}
    }

    disable() {
    	if (this.app_grid) {
    		this.app_grid._destroy();
    	}
    	
    	if (this.favorites_menu) {
    		this.favorites_menu._destroy();
    	}
    	
    	if (this.workspaces_bar) {
    		this.workspaces_bar._destroy();
    	}
    	
    	// restore top panel left box padding
    	if (REDUCE_PADDING) {
    		Main.panel._leftBox.remove_style_class_name('leftbox-reduced-padding');
    	}
    	
    	// restore Places label and unwatch extensions changes
    	if (this.places_indicator && DISPLAY_PLACES_ICON) {
    		this._show_places_icon(false);
    		Main.extensionManager.disconnect(this.extensions_changed);
    	}
    	
    	// restore Activities button
    	this._show_activities(true);
    	
    	// restore AppMenu icon
    	if (!Main.overview.visible && !Main.sessionMode.isLocked) {
			AppMenu.container.show();
		}
		
		// unwatch settings
		this.settings.disconnect(this.settings_changed);
    }
}

function init() {
	return new Extension();
}

