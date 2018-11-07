define(['knockout', 'text!./faceted-datatable.html', 'crossfilter', 'colvis', 'services/Facets'], function (ko, view, crossfilter, colvis, facetService) {

	function facetedDatatable(params) {
		const self = this;

		self.headersTemplateId = params.headersTemplateId;
		self.componentLoading = ko.observable(true);
		self.facets = ko.observableArray();

		self.nullFacetLabel = params.nullFacetLabel || 'NULL';
		self.options = params.options;
		self.columns = params.columns;
		self.rowCallback = params.rowCallback || function () {};
		self.rowClick = params.rowClick;
		self.drawCallback = params.drawCallback;

		// Set some defaults for the data table
		self.autoWidth = params.autoWidth || true;
		self.buttons = params.buttons || [
			'colvis', 'copyHtml5', 'excelHtml5', 'csvHtml5', 'pdfHtml5'
		];
		self.colVis = params.colVis || {
			buttonText: 'Change Columns',
			align: 'right',
			overlayFade: 0,
			showAll: 'Show All Columns',
			restore: 'Reset Columns'
		};
		self.deferRender = params.deferRender || true;
		self.dom = params.dom || '<<"row vertical-align"<"col-xs-6"<"dt-btn"B>l><"col-xs-6 search"f>><"row vertical-align"<"col-xs-3"i><"col-xs-9"p>><t><"row vertical-align"<"col-xs-3"i><"col-xs-9"p>>>';
		self.language = params.language || {
			search: 'Filter: '
		};
		self.pageLength = params.pageLength || 15;
		self.lengthMenu = params.lengthMenu || [
			[15, 30, 45, 100, -1],
			[15, 30, 45, 100, 'All']
		];
		self.order = params.order || [
			[1, 'desc']
		];
		self.orderColumn = 1;
		if (params.orderColumn) {
			self.order = [
				[params.orderColumn, 'desc']
			]
		}
		self.orderClasses = params.orderClasses || false;
		self.ordering = params.ordering || true;
		self.scrollOptions = params.scrollOptions || null;

		self.dtApi = ko.observable(); // store reference to datatable
		if (params.api) {
			self.dtApi.subscribe(a => {
				params.api(a)
			});
		}

		if (params.ajax && self.options && self.options.entityName) {
			self.ajax = (d, callback, settings) => {
				if (self.facets().length !== 0) {
					self.componentLoading(true);
					params.ajax({
						page: d.start / d.length,
						size: d.length,
						text:d.search.value,
						facets: self.facets()
							.filter(f => Object.keys(f.selectedItems).length !== 0)
							.map(f => f.caption + '=' + Object.keys(f.selectedItems)).join('&'),
						sort: self.order.map(s => {
							return [params.columns[s[0]].data, s[1]]
						})
					})
					.then(({data}) => {
						callback({
							draw: d.draw,
							recordsTotal: data.totalElements,
							recordsFiltered: data.totalElements,
							data: data.content
						});
						self.componentLoading(false);
					})
					.catch(e => {
						console.error(e);
						self.componentLoading(false);
					})
				}
			};
			self.createFilters = () => {
				facetService.getFacets(self.options.entityName)
					.then(({data}) => {
						self.facets(data.map(facet => {
							return {
								'caption': facet.name,
								'selectedItems': {},
								'facetItems': facet.selectedItems.map(item => {
									return {
										key: item.key,
										text: item.text,
										count: item.count,
										selected: ko.observable(false),
										facet: facet
									}
								}),
							};
						}));
						if (self.options.Facets) {
							self.options.Facets.forEach(facet => {
								if (facet.defaultFacets) {
									facet.defaultFacets.forEach(defaultFacet => {
										self.facets().forEach(f => {
											let facetItem = f.facetItems.find(f => f.key === defaultFacet);
											if (facetItem) {
												self.updateFilters(facetItem, null);
											}
										})
									})
								}
							});
						}
					})
					.catch(e => {
						console.error(e)
					})
			};
			self.updateFilters = function (data, event) {
				let facet = self.facets().find(f => f.caption === data.facet.name);
				data.selected(!data.selected());
				if (data.selected()) {
					if (!facet.selectedItems.hasOwnProperty(data.key)) {
						facet.selectedItems[data.key] = data;
					}
				} else {
					delete facet.selectedItems[data.key];
				}
				self.facets.valueHasMutated();
			};
			self.createFilters();
		} else {
			self.ajax = null;
			self.reference = params.reference;
			self.data = params.xfObservable || ko.observable();
			self.tableData = ko.pureComputed(function () {
				if (self.data() && self.data().size() && self.data().size() > 0) {
					return self.data().allFiltered();
				} else {
					return [];
				}
			});
			self.updateFilters = function (data, event) {
				var facet = data.facet;
				data.selected(!data.selected());
				if (data.selected()) {
					if (!facet.selectedItems.hasOwnProperty(data.key)) {
						facet.selectedItems[data.key] = data;
					}
				} else {
					delete facet.selectedItems[data.key];
				}
				var filter = [];
				$.each(facet.selectedItems, function (i, n) {
					filter.push(n.key);
				});
				if (filter.length <= 0) {
					facet.dimension.filterAll();
				} else {
					facet.dimension.filter(function (d) {
						return filter.indexOf(d) > -1;
					});
				}
				self.data.valueHasMutated();
			}

			// additional helper function to help with crossfilter-ing dimensions that contain nulls
			self.facetDimensionHelper = function facetDimensionHelper(val) {
				var ret = val === null ? self.nullFacetLabel : val;
				return ret;
			}

			self.reference.subscribe(function (newValue) {
				if (self.reference() != null) {
					self.componentLoading(true);
					self.data(new crossfilter(self.reference()));
					self.facets.removeAll();
					if (self.options && self.options.Facets) {
						// Iterate over the facets and set the dimensions
						self.options.Facets.forEach(facetConfig => {
							var isArray = facetConfig.isArray || false;
							var dimension = self.data().dimension(d => self.facetDimensionHelper(facetConfig.binding(d)), isArray);
							var facet = {
								'caption': facetConfig.caption,
								'binding': facetConfig.binding,
								'dimension': dimension,
								'facetItems': [],
								'selectedItems': new Object(),
							};
							// Add a selected observable to each dimension
							dimension.group().top(Number.POSITIVE_INFINITY).forEach(facetItem => {
								facetItem.text = facetItem.key;
								facetItem.count = facetItem.value;
								facetItem.dimension = dimension;
								facetItem.selected = ko.observable(false);
								facetItem.facet = facet;
								facet.facetItems.push(facetItem);
							});
							self.facets.push(facet);
						});
						// Iterate over the facets and set any defaults
						$.each(self.options.Facets, function (i, facetConfig) {
							if (facetConfig.defaultFacets && facetConfig.defaultFacets.length > 0) {
								$.each(facetConfig.defaultFacets, function (d, defaultFacet) {
									var facetItem = $.grep(self.facets()[i].facetItems, function (f) {
										return f.key == defaultFacet;
									});
									if (facetItem.length > 0) {
										self.updateFilters(facetItem[0], null);
									}
								})
							}
						});
					}
					self.componentLoading(false);
				}
			});

			self.reference.valueHasMutated(); // init component
		}
	}

	let component = {
		viewModel: facetedDatatable,
		template: view
	};

	ko.components.register('faceted-datatable', component);
	return component;
});
