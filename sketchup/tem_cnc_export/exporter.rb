require 'sketchup.rb'
require 'json'

module TemCnc
  module Exporter
    module_function

    def export(model, path)
      parts = []
      collect_boards(model.entities, Geom::Transformation.new, [], nesting_data(model), parts)
      raise 'Mô hình chưa có cấu kiện được ABF đánh số.' if parts.empty?

      project = {
        format: 'tem-cnc-abf',
        version: 1,
        name: model.title.empty? ? 'Đơn cắt mới' : model.title,
        parts: parts.sort_by { |part| part[:code] }
      }
      File.open(path, 'wb') { |file| file.write(JSON.generate(project)) }
      { path: path, parts: parts.size, triangles: parts.sum { |part| part[:triangles].size / 3 } }
    end

    def collect_boards(entities, transform, path, cutting, parts)
      entities.each do |entity|
        next unless container?(entity)
        next if abf(entity, 'is-nesting-root') || entity.name == '__ABF_Nesting'

        local_to_model = transform * entity.transformation
        name = entity.name.strip
        index = abf(entity, 'board-index')
        if abf(entity, 'is-board') && index.to_s.match?(/\A\d+\z/)
          parts << serialize_board(entity, index.to_i, name, path, local_to_model, cutting)
          next
        end
        collect_boards(children(entity), local_to_model, name.empty? ? path : path + [name], cutting, parts)
      end
    end

    def serialize_board(entity, code, name, path, transform, cutting)
      vertices = []
      triangles = []
      collect_mesh(children(entity), transform, vertices, triangles, {})
      suffix = name.sub(/\A__\d+\.?\s*/, '').strip
      label = suffix.empty? ? "Cấu kiện #{code}" : suffix
      dimensions = transformed_dimensions(entity.definition.bounds, transform)
      {
        id: entity.persistent_id.to_s,
        code: code,
        name: label,
        group: path.empty? ? (label[/\Acăn\s+\d+/i] || 'Chưa gán nhóm') : path.join(' / '),
        path: path,
        position: coordinates(entity.definition.bounds.center.transform(transform)),
        modelSize: dimensions,
        cut: cutting[code],
        vertices: vertices,
        triangles: triangles
      }
    end

    def collect_mesh(entities, transform, vertices, triangles, vertex_indices)
      entities.each do |entity|
        if entity.is_a?(Sketchup::Face)
          mesh = entity.mesh(0)
          indices = mesh.points.map do |point|
            value = coordinates(point.transform(transform))
            vertex_indices.fetch(value) do
              index = vertices.length / 3
              vertices.concat(value)
              vertex_indices[value] = index
            end
          end
          mesh.polygons.each do |polygon|
            face = polygon.map { |number| indices.fetch(number.abs - 1) }
            (1...(face.length - 1)).each { |i| triangles.concat([face[0], face[i], face[i + 1]]) }
          end
        elsif container?(entity) && !entity.hidden? && !entity.name.start_with?('_ABF')
          collect_mesh(children(entity), transform * entity.transformation, vertices, triangles, vertex_indices)
        end
      end
    end

    def nesting_data(model)
      root = model.entities.find { |entity| container?(entity) && (abf(entity, 'is-nesting-root') || entity.name == '__ABF_Nesting') }
      return {} unless root

      cutting = {}
      children(root).each do |sheet|
        next unless container?(sheet)

        sheet_id = abf(sheet, 'sheet-id')
        sheet_type = abf(sheet, 'sheet-type')
        sheet_thickness = abf(sheet, 'sheet-thickness')
        # ABF stores sheet-thickness in millimetres even though SketchUp bounds are in inches.
        thickness = sheet_thickness.is_a?(Numeric) ? sheet_thickness.to_f.round(2) : nil
        children(sheet).each do |board|
          index = abf(board, 'board-index')
          next unless index.to_s.match?(/\A\d+\z/) && container?(board)

          size = [board.bounds.width, board.bounds.height].map { |length| length.to_mm.round(2) }.sort.reverse
          cutting[index.to_i] = { sheet: sheet_id, material: sheet_type.to_s, size: size, thickness: thickness }
        end
      end
      cutting
    end

    def transformed_dimensions(bounds, transform)
      [bounds.width.to_f * transform.xaxis.length, bounds.height.to_f * transform.yaxis.length,
       bounds.depth.to_f * transform.zaxis.length].map { |value| value.to_mm.round(2) }.sort.reverse
    end

    def coordinates(point)
      point.to_a.map { |value| value.to_mm.round(2) }
    end

    def container?(entity)
      entity.is_a?(Sketchup::Group) || entity.is_a?(Sketchup::ComponentInstance)
    end

    def children(entity)
      entity.definition.entities
    end

    def abf(entity, key)
      entity.get_attribute('ABF', key)
    end

    def export_dialog
      model = Sketchup.active_model
      title = model.title.gsub(/[<>:"\/\\|?*]/, '_')
      filename = title.empty? ? 'don-cat' : title
      path = UI.savepanel('Xuất mô hình cho Tem CNC', nil, "#{filename}.abf.json")
      return unless path

      path += '.abf.json' unless path.downcase.end_with?('.abf.json')
      result = export(model, path)
      UI.messagebox("Đã xuất #{result[:parts]} cấu kiện.\nMở Tem CNC và nạp file .abf.json vừa xuất.")
    rescue StandardError => error
      UI.messagebox("Không xuất được mô hình.\n#{error.message}")
    end
  end

  unless defined?(MENU_REGISTERED)
    UI.menu('Extensions').add_item('Tem CNC • Xuất mô hình ABF') { Exporter.export_dialog }
    MENU_REGISTERED = true
  end
end
