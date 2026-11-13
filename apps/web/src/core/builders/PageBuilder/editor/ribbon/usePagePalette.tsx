import { libraryComponentLabel } from '../../../../components/Registry/componentLibraryDiscovery';
import { useEffect } from 'react';
import {
CalendarDays, Grid2X2, Type, Square, Image as ImageIcon, MousePointer2, BarChart3, FormInput,
ToggleRight, List, Puzzle, Search, Star, Layers3, ShoppingCart, PanelsTopLeft, MessageCircle,
BadgeCheck, Table2, Menu, Repeat, Keyboard, PanelBottom
} from 'lucide-react';
import { isBuilderApi } from '../../builderPropertyInventory';
import { layoutTypes } from '../../../../pages/TemplatePageRuntime/pageComponentLayout';
import { standardPageComponents } from '../../../../components/Catalog/index';
import {
getPageBuilderComponentCategories, publishedPageLibraryComponents,
pageBuilderPaletteCategories,
} from '../../pageBuilderPalette';
import { pageBuilderCategoryLabels } from '../../pageBuilderUx';

import type { PageBuilderProps } from '../PageBuilderTypes';
import type { usePageEditorState } from '../usePageEditorState';

export function usePagePalette(
  props: PageBuilderProps,
  editorState: ReturnType<typeof usePageEditorState>,
) {
  const { page, libraryComponents, onNotify, pages } = props;
  const {
    availableComponents, ribbonCatalog, favouriteComponents, recentComponents,
    setFavouriteComponents, setFavouritesLoaded, favouritesLoaded, savedPageApiName,
    setCustomPropertiesDraft, selected, setCustomPropertiesError, setSelectedId, setPaletteTab,
    setFitCanvas, setUndoStack, setRedoStack, setSelectionUndoStack, setSelectionRedoStack,
    setPreviewMode, setSavedFeedback, setPageSettingsOpen, setDynamicFormsUpgradeOpen,
    setMigrationLayoutId,
  } = editorState;

  const paletteComponents = [
    // Legacy Row, Column, Card and Container are renderers, not additional Insert components.
    // Keep the registered Smart Container as the single new Container choice.
    // Preserve their runtime support for existing pages; do not offer new instances.
    ...layoutTypes.filter(type=>!['Row','Column','Card','Container'].includes(type)).map((type) => ({ id: type, type, label: type, description: `Nest components inside a ${type.toLowerCase()} layout.`, categories: ['Layout'] as (typeof pageBuilderPaletteCategories)[number][] })),
    ...(page.layoutMode === 'template' ? standardPageComponents
      .filter((component) => availableComponents.includes(component.apiName))
      .map((component) => ({
        id: component.apiName,
        type: component.apiName,
        label: component.label,
        description: component.description,
        categories: getPageBuilderComponentCategories(component.apiName, component.label, component.description, true)
      })) : []),
    ...(page.pageType==='Record Page' ? [{
      id: 'Field Section',
      type: 'Field Section',
      label: 'Field Section',
      description: 'Group selected record fields into a one- or two-column section.',
      categories: ['Layout'] as (typeof pageBuilderPaletteCategories)[number][]
    }] : []),
    ...libraryComponents.filter(component=>isBuilderApi(component.apiName,ribbonCatalog?.components??[])
      &&component.apiName!=='smart_icon' // Legacy instances stay registered; new pages use Button + Shape.
      &&component.status!=='Draft').map(component=>({
      id:'Custom:'+component.apiName,
      type:'Custom:'+component.apiName,
      label:component.apiName==='smart_textbox'?'Smart Textbox':component.apiName==='smart_card_grid'?'Card Grid':component.apiName==='smart_lookup'?'Lookup Record':
        component.apiName==='smart_text'?'Input Box':component.apiName==='smart_navigation'?'Navigation Bar':
        component.apiName.startsWith('smart_')?component.apiName.slice(6).split('_').map(word=>word[0].toUpperCase()+word.slice(1)).join(' '):component.label,
      description:component.description,
      categories:getPageBuilderComponentCategories(component.apiName,component.label,component.description,false,
        component.category)
    })),
    ...publishedPageLibraryComponents(libraryComponents).filter(component=>!isBuilderApi(component.apiName,ribbonCatalog?.components??[])).map((component) => ({
      id: `Custom:${component.apiName}`,
      type: `Custom:${component.apiName}`,
      label: libraryComponentLabel(component),
      description: component.description,
      categories: getPageBuilderComponentCategories(component.apiName, component.label, component.description, false, component.category)
    }))
  ];
  const renderPaletteIcon = (component: { type: string; label: string }) => {
    // Smart component kinds use distinctive icons.
    // Otherwise the generic fallback gives Navigation the Button icon and
    // Toggle the Input icon, making insertion choices unnecessarily ambiguous.
    switch(component.type){
      case 'Custom:smart_navigation':return <Menu size={15}/>;
      case 'Custom:smart_container':return <Layers3 size={15}/>;
      case 'Custom:smart_icon':return <Star size={15}/>;
      case 'Custom:smart_toggle':return <ToggleRight size={15}/>;
      case 'Custom:smart_keyboard':return <Keyboard size={15}/>;
      case 'Custom:smart_dock':return <PanelBottom size={15}/>;
    }
    const name = `${component.label} ${component.type}`.toLowerCase();
    if (/\b(text|heading|paragraph|rich text|label)\b/.test(name)) return <Type size={15} />;
    if (/\b(image|photo|picture|avatar|logo)\b/.test(name)) return <ImageIcon size={15} />;
    if (/\b(cart|checkout|shopping)\b/.test(name)) return <ShoppingCart size={15} />;
    if (/\b(calendar|date.picker)\b/.test(name)) return <CalendarDays size={15} />;
    if (/\b(tabs?|accordion)\b/.test(name)) return <PanelsTopLeft size={15} />;
    if (/\b(conversation|chat|message)\b/.test(name)) return <MessageCircle size={15} />;
    if (/\b(badge|status)\b/.test(name)) return <BadgeCheck size={15} />;
    if (/\b(table)\b/.test(name)) return <Table2 size={15} />;
    if (/\b(menu)\b/.test(name)) return <Menu size={15} />;
    if (/\b(repeater|repeat)\b/.test(name)) return <Repeat size={15} />;
    if (/\b(search|lookup)\b/.test(name)) return <Search size={15} />;
    if (/\b(grid|columns?|rows?|layout)\b/.test(name)) return <Grid2X2 size={15} />;
    if (/\b(shape|rectangle|square|circle|line|divider|spacer)\b/.test(name)
      || layoutTypes.some((type) => type === component.type)) return <Square size={15} />;
    if (/\b(button|link|navigation|action)\b/.test(name)) return <MousePointer2 size={15} />;
    if (/\b(input|form|checkbox|select|field|date|toggle)\b/.test(name)) return <FormInput size={15} />;
    if (/\b(chart|metric|dashboard|activity|report)\b/.test(name)) return <BarChart3 size={15} />;
    if (/\b(table|list|related|record|database)\b/.test(name)) return <List size={15} />;
    return <Puzzle size={15} />;
  };
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('metadrive:page-builder:favourites');
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
          throw new Error('Saved favourites are not a list of component IDs.');
        }
        setFavouriteComponents(parsed);
      }
    } catch (failure) {
      onNotify(`Unable to load component favourites: ${failure instanceof Error ? failure.message : 'Browser storage is unavailable.'}`);
    } finally {
      setFavouritesLoaded(true);
    }
  }, []);
  useEffect(() => {
    if (!favouritesLoaded) return;
    try {
      window.localStorage.setItem('metadrive:page-builder:favourites', JSON.stringify(favouriteComponents));
    } catch (failure) {
      onNotify(`Unable to save component favourites: ${failure instanceof Error ? failure.message : 'Browser storage is unavailable.'}`);
    }
  }, [favouriteComponents, favouritesLoaded]);
  useEffect(() => {
    try { window.localStorage.setItem('metadrive:page-builder:recent', JSON.stringify(recentComponents)); }
    catch { /* Recent blocks are optional device-local preferences. */ }
  }, [recentComponents]);
  useEffect(() => {
    const savedIdentityExists = pages.some((item) => item.apiName === savedPageApiName.current);
    const currentIdentityExists = pages.some((item) => item.apiName === page.apiName);
    if (!savedIdentityExists && currentIdentityExists) savedPageApiName.current = page.apiName;
  }, [page.apiName, pages]);
  useEffect(() => {
    setCustomPropertiesDraft(selected?.type.startsWith('Custom:') ? JSON.stringify(selected.properties, null, 2) : '');
    setCustomPropertiesError('');
  }, [selected?.id, selected?.type]);
  useEffect(() => {
    setSelectedId(page.components[0]?.id ?? '');
    setPaletteTab('Components');
    // Render the saved page at its fixed device size; no editor device switch.
    setFitCanvas(true);
    setUndoStack([]);
    setRedoStack([]);
    setSelectionUndoStack([]);
    setSelectionRedoStack([]);
    setPreviewMode(false);
    setSavedFeedback(false);
    setPageSettingsOpen(false);
    setDynamicFormsUpgradeOpen(false);
    setMigrationLayoutId('');
  }, []);
  useEffect(() => {
    setFitCanvas(true);
  }, [page.apiName]);

  return {
    paletteComponents, renderPaletteIcon,
  };
}
